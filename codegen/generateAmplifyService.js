#!/usr/bin/env node
/**
 * AmplifyQuery codegen (POC)
 * - Input: amplify_outputs.json (Amplify Gen2 output)
 * - Output: a typed AmplifyService module (TS)
 *
 * Usage:
 *   node packages/AmplifyQuery/codegen/generateAmplifyService.js \
 *     --outputs apps/noteCube/_backend/amplify_outputs.json \
 *     --out apps/noteCube/src/amplifyService/generated.ts
 */
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = val;
  }
  return out;
}

function pascalCase(str) {
  if (!str) return str;
  return String(str)
    .replace(/[_\-\s]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join("");
}

function camelCase(str) {
  const p = pascalCase(str);
  return p ? p.slice(0, 1).toLowerCase() + p.slice(1) : p;
}

function mapScalarToTs(typeName) {
  switch (typeName) {
    case "String":
    case "ID":
    case "AWSDateTime":
    case "AWSDate":
    case "AWSTime":
    case "AWSTimestamp":
      return "string";
    case "Boolean":
      return "boolean";
    case "Int":
    case "Float":
      return "number";
    case "AWSJSON":
      return "any";
    default:
      // Fallback: keep unknown scalars as any
      return "any";
  }
}

function fieldTypeToTs(field) {
  // Field `type` can be string scalar, or { model }, or { nonModel }, or { enum }
  const t = field.type;
  let base;
  if (typeof t === "string") {
    base = mapScalarToTs(t);
  } else if (t && typeof t === "object") {
    if (t.model) base = t.model;
    else if (t.nonModel) base = t.nonModel;
    else if (t.enum) base = t.enum;
    else base = "any";
  } else {
    base = "any";
  }

  if (field.isArray) {
    return `${base}[]`;
  }
  return base;
}

function pickOwnerQueryMap(models) {
  const map = {};
  for (const [modelName, modelDef] of Object.entries(models || {})) {
    const attrs = Array.isArray(modelDef.attributes) ? modelDef.attributes : [];
    // Find a key with fields: ["owner"] and queryField
    const ownerKey = attrs.find(
      (a) =>
        a &&
        a.type === "key" &&
        a.properties &&
        Array.isArray(a.properties.fields) &&
        a.properties.fields.length === 1 &&
        a.properties.fields[0] === "owner" &&
        typeof a.properties.queryField === "string" &&
        a.properties.queryField.length > 0
    );
    if (ownerKey) {
      map[modelName] = ownerKey.properties.queryField;
    }
  }
  return map;
}

function getIndexes(models) {
  // returns: { [modelName]: Array<{ queryField, fields: string[] }> }
  const out = {};
  for (const [modelName, modelDef] of Object.entries(models || {})) {
    const attrs = Array.isArray(modelDef.attributes) ? modelDef.attributes : [];
    const keys = attrs
      .filter((a) => a && a.type === "key" && a.properties && a.properties.queryField)
      .map((a) => ({
        queryField: a.properties.queryField,
        fields: Array.isArray(a.properties.fields) ? a.properties.fields : [],
        name: a.properties.name,
      }))
      .filter((k) => typeof k.queryField === "string" && k.queryField.length > 0);
    out[modelName] = keys;
  }
  return out;
}

function getAwsJsonFieldsByModel(models) {
  const out = {};
  for (const [modelName, modelDef] of Object.entries(models || {})) {
    const fields = modelDef?.fields || {};
    const awsJsonFields = Object.entries(fields)
      .filter(([, fieldDef]) => fieldDef?.type === "AWSJSON")
      .map(([fieldName]) => fieldName);
    out[modelName] = awsJsonFields;
  }
  return out;
}

function inferBelongsToTargetModel(models, modelName, idFieldName) {
  // Find a field that BELONGS_TO and targets idFieldName, then return the related model name
  const modelDef = models?.[modelName];
  if (!modelDef?.fields) return null;
  for (const f of Object.values(modelDef.fields)) {
    if (!f || typeof f !== "object") continue;
    const assoc = f.association;
    const t = f.type;
    const isModelRef = t && typeof t === "object" && t.model;
    if (!assoc || !isModelRef) continue;
    if (assoc.connectionType !== "BELONGS_TO") continue;
    const targets = Array.isArray(assoc.targetNames) ? assoc.targetNames : [];
    if (targets.includes(idFieldName)) {
      return t.model;
    }
  }
  return null;
}

function generateTs({ outputsJson, headerComment }) {
  const introspection = outputsJson?.data?.model_introspection;
  if (!introspection || !introspection.models) {
    throw new Error(
      "amplify_outputs.json is missing data.model_introspection.models (cannot generate types)"
    );
  }

  const models = introspection.models;
  const nonModels = introspection.nonModels || {};
  const enums = introspection.enums || {};

  const modelNames = Object.keys(models);

  const ownerQueryMap = pickOwnerQueryMap(models);
  const indexesByModel = getIndexes(models);
  const awsJsonFieldsByModel = getAwsJsonFieldsByModel(models);

  const lines = [];
  lines.push("/* eslint-disable */");
  lines.push("/**");
  lines.push(` * ${headerComment}`);
  lines.push(" *");
  lines.push(" * DO NOT EDIT MANUALLY.");
  lines.push(" */");
  lines.push("");
  lines.push(
    `import { AmplifyQuery, createQueryKeys, Utils, type AuthMode, type AmplifyDataService, type ModelHook, type SingletonAmplifyService } from "amplifyquery";`
  );
  lines.push("");

  // Enums (minimal)
  for (const [enumName, enumDef] of Object.entries(enums)) {
    const values = Array.isArray(enumDef?.values) ? enumDef.values : [];
    if (values.length === 0) continue;
    const union = values.map((v) => JSON.stringify(v)).join(" | ");
    lines.push(`export type ${enumName} = ${union};`);
    lines.push("");
  }

  // Non-models (minimal interface)
  for (const [nmName, nmDef] of Object.entries(nonModels)) {
    const fields = nmDef?.fields || {};
    lines.push(`export interface ${nmName} {`);
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const tsType = fieldTypeToTs(fieldDef);
      const optional = fieldDef?.isRequired ? "" : "?";
      lines.push(`  ${fieldName}${optional}: ${tsType};`);
    }
    lines.push("}");
    lines.push("");
  }

  // Models (typed interface)
  for (const [modelName, modelDef] of Object.entries(models)) {
    const fields = modelDef?.fields || {};
    lines.push(`export interface ${modelName} {`);
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const tsType = fieldTypeToTs(fieldDef);
      // Ensure BaseModel-ish fields are present as required if they exist in schema
      const isBaseField = fieldName === "id" || fieldName === "createdAt" || fieldName === "updatedAt";
      const optional = fieldDef?.isRequired || isBaseField ? "" : "?";
      lines.push(`  ${fieldName}${optional}: ${tsType};`);
    }
    lines.push("}");
    lines.push("");
  }

  // Model names + query keys
  lines.push(`export const modelNames = ${JSON.stringify(modelNames, null, 2)} as const;`);
  lines.push(`export const queryKeys = createQueryKeys([...modelNames]);`);
  lines.push("");

  // owner query map export (optional but useful for configure)
  lines.push(`export const modelOwnerQueryMap: Record<string, string> = ${JSON.stringify(ownerQueryMap, null, 2)};`);
  lines.push("");
  lines.push(
    `export const modelAwsJsonFieldMap: Record<string, string[]> = ${JSON.stringify(
      awsJsonFieldsByModel,
      null,
      2
    )};`
  );
  lines.push("");

  // Auth utils
  lines.push("export const AuthUtils = {");
  lines.push("  withAuthMode: <T>(service: AmplifyDataService<T>, authMode: AuthMode): AmplifyDataService<T> => {");
  lines.push("    return service.withAuthMode(authMode);");
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");

  // Services
  // Base services
  for (const modelName of modelNames) {
    lines.push(
      `const ${modelName}Base = AmplifyQuery.createAmplifyService<${modelName}>(${JSON.stringify(
        modelName
      )}, undefined, { awsJsonFields: modelAwsJsonFieldMap[${JSON.stringify(
        modelName
      )}] || [], awsJsonAutoTransform: true });`
    );
  }
  lines.push("");

  // Extended services with index helpers
  for (const modelName of modelNames) {
    const keys = indexesByModel[modelName] || [];

    // Singleton rule: model name "User" treated as singleton via getModelIds.User
    if (modelName === "User") {
      lines.push(
        `const ${modelName}Service: SingletonAmplifyService<${modelName}> = AmplifyQuery.createSingletonService<${modelName}>(${modelName}Base, AmplifyQuery.getModelIds.User);`
      );
      continue;
    }

    // Build extensions object for keys
    const extensionLines = [];
    const usedExtensionNames = new Set();

    for (const k of keys) {
      // Only support single-field indexes for POC (easy to call and type)
      if (!Array.isArray(k.fields) || k.fields.length !== 1) continue;
      const fieldName = k.fields[0];
      const queryName = k.queryField;
      if (typeof fieldName !== "string" || typeof queryName !== "string") continue;

      const baseSuffix = pascalCase(fieldName.replace(/Id$/, "")); // userId -> User, status -> Status
      const fallbackSuffix = pascalCase(fieldName); // userId -> UserId
      let suffix = baseSuffix;
      let listFnName = `listBy${suffix}`;
      let hookFnName = `useListBy${suffix}Hook`;

      if (usedExtensionNames.has(listFnName) || usedExtensionNames.has(hookFnName)) {
        suffix = fallbackSuffix;
        listFnName = `listBy${suffix}`;
        hookFnName = `useListBy${suffix}Hook`;
      }

      if (usedExtensionNames.has(listFnName) || usedExtensionNames.has(hookFnName)) {
        let i = 2;
        while (
          usedExtensionNames.has(`listBy${fallbackSuffix}${i}`) ||
          usedExtensionNames.has(`useListBy${fallbackSuffix}${i}Hook`)
        ) {
          i += 1;
        }
        suffix = `${fallbackSuffix}${i}`;
        listFnName = `listBy${suffix}`;
        hookFnName = `useListBy${suffix}Hook`;
      }

      usedExtensionNames.add(listFnName);
      usedExtensionNames.add(hookFnName);

      // Determine param type from schema field
      const fieldDef = models?.[modelName]?.fields?.[fieldName];
      const paramTsType = fieldDef ? fieldTypeToTs(fieldDef) : "string";
      // If field is array, parameter should be scalar; ignore arrays
      const paramType = String(paramTsType).endsWith("[]") ? "string" : paramTsType;

      // For *Id fields that have BELONGS_TO association, prefer relational hook generator
      const belongsToModel =
        fieldName.endsWith("Id") ? inferBelongsToTargetModel(models, modelName, fieldName) : null;
      if (belongsToModel) {
        extensionLines.push(
          `  ${hookFnName}: AmplifyQuery.createRelationalHook(${modelName}Base, ${JSON.stringify(
            belongsToModel
          )}, ${JSON.stringify(queryName)}, ${JSON.stringify(fieldName)}),`
        );
      } else {
        // Generic customList hook (non-relational)
        extensionLines.push(
          `  ${hookFnName}: (${camelCase(fieldName)}: ${paramType}): ModelHook<${modelName}> => {`
        );
        extensionLines.push(
          `    return ${modelName}Base.useHook({ customList: { queryName: ${JSON.stringify(
            queryName
          )}, args: { ${fieldName}: ${camelCase(fieldName)} } } });`
        );
        extensionLines.push("  },");
      }

      // List function
      extensionLines.push(
        `  ${listFnName}: (${camelCase(fieldName)}: ${paramType}, options?: { forceRefresh?: boolean; throwOnError?: boolean }) => {`
      );
      extensionLines.push(
        `    return ${modelName}Base.customList(${JSON.stringify(queryName)}, { ${fieldName}: ${camelCase(
          fieldName
        )} }, options);`
      );
      extensionLines.push("  },");
    }

    if (extensionLines.length > 0) {
      lines.push(`const ${modelName}Service = ${modelName}Base.withExtensions({`);
      lines.push(...extensionLines);
      lines.push("});");
    } else {
      lines.push(`const ${modelName}Service = ${modelName}Base;`);
    }
  }

  lines.push("");
  lines.push("export const AmplifyService = {");
  lines.push("  Utils,");
  lines.push("  AuthUtils,");
  for (const modelName of modelNames) {
    lines.push(`  ${modelName}: ${modelName}Service,`);
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export default AmplifyService;");
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const outputsPath = args.outputs;
  const outPath = args.out;

  if (!outputsPath || !outPath) {
    console.error("Missing required args: --outputs <path> --out <path>");
    process.exit(1);
  }

  const absOutputs = path.isAbsolute(outputsPath)
    ? outputsPath
    : path.join(process.cwd(), outputsPath);
  const absOut = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);

  const raw = fs.readFileSync(absOutputs, "utf8");
  const json = JSON.parse(raw);

  const headerComment = `AUTO-GENERATED by AmplifyQuery from ${path.basename(absOutputs)}`;
  const ts = generateTs({ outputsJson: json, headerComment });

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, ts, "utf8");
  console.log(`✅ Generated ${absOut}`);
}

main();
