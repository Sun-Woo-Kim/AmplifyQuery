module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        // 커밋 메시지 전체를 제목으로 인식하도록 파서 설정
        parserOpts: {
          headerPattern: /^(.*)$/,
          headerCorrespondence: ["subject"],
        },
        // 어떤 커밋이든 'patch' 릴리즈를 하도록 규칙 설정
        releaseRules: [{ release: "patch" }],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        // 커밋 메시지 전체를 제목으로 인식하도록 파서 설정
        parserOpts: {
          headerPattern: /^(.*)$/,
          headerCorrespondence: ["subject"],
        },
        // 릴리즈 노트 생성기 커스터마이징
        writerOpts: {
          // 커밋 객체를 변환하는 함수
          transform: (commit) => {
            // 기본 'angular' 프리셋은 특정 타입(feat, fix 등)만 보여줌
            // 모든 커밋이 릴리즈 노트에 포함되도록 타입을 'fix'로 강제 할당
            commit.type = "fix";
            return commit;
          },
        },
      },
    ],
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        npmPublish: true,
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "package-lock.json", "CHANGELOG.md"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    "@semantic-release/github",
  ],
};
