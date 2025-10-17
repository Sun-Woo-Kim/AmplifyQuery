## [1.0.14](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.13...v1.0.14) (2025-10-17)


### fix

* feat: add query key helpers and refactor cache handling in service.ts ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/0457a65ab7472f1d30bfea680f3147feedc2418a))

## [1.0.13](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.12...v1.0.13) (2025-10-17)


### fix

* feat: add useCurrentHook ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/88bd1ec2c9354fbff186e1eaf3e30dc722d1fa45))

## [1.0.12](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.11...v1.0.12) (2025-09-24)


### fix

* feat: update create function (include id) ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/72afd965e28d0f636050d9a93dca8974d5afe50b))

## [1.0.11](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.10...v1.0.11) (2025-08-05)


### fix

* chore(release): 1.0.9 [skip ci] ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/f744942318b73d54691480fc5ebb42bcdbe8c1fa))
* 캐시 제거 로직 최적화 및 refetch 조건 수정: 캐시가 존재할 경우 refetch를 비활성화하고, 로딩 완료 후 캐시 정리를 위한 효과를 추가했습니다. 무한 루프 방지를 위해 setTimeout을 사용하여 캐시를 조용히 제거하도록 개선했습니다. ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/94641e813224ac3bb674d7611c602519d0d8708a))

## [1.0.9](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.8...v1.0.9) (2025-08-04)


### fix

* fetch ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/11d68238c976010dae9dc27b9031be75061a0c05))
* fix get query ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/adfd42a2679d3227541b55c9baeccfa142532839))
* 버전 1.0.10으로 업데이트: useItemHook에서 캐시에 배열이 저장된 경우 처리 로직 추가 및 캐시 제거 기능 개선 ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/76a11446b58fcd6c03565d135d98124286fc9915))
* 서비스 파일에서 ID 검증 로직을 추가하여 캐시 업데이트 및 롤백 시 안정성을 향상시켰습니다. 코드 전반에 걸쳐 세미콜론을 추가하여 일관성을 유지했습니다. ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/660eab81b08bc77c98bf8be877f0476b8398350e))

## [1.0.10](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.9...v1.0.10) (2025-01-06)


### fix

* 버그 수정: useItemHook에서 캐시에 배열이 저장된 경우 처리 로직 추가
* 캐시에 배열이 있을 경우 해당 캐시를 제거하고 다시 조회하도록 개선

## [1.0.9](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.8...v1.0.9) (2025-01-06)


### fix

* 버그 수정: useItemHook이 단일 아이템 대신 배열을 반환하는 문제 수정
* API가 단일 아이템 대신 배열을 반환하는 경우 처리 로직 추가

## [1.0.8](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.7...v1.0.8) (2025-07-16)


### fix

* 버그 수정: ID 검증 로직 추가로 캐시 업데이트 및 롤백 시 안정성 향상 ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/84865431e74327c9268b8cd5e1af7535fc5c1289))

## [1.0.7](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.6...v1.0.7) (2025-06-15)


### fix

* fixREADME.md ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/11fbce7a02f6854a7bf79c50f96538b927ee40bb))

## [1.0.6](https://github.com/Sun-Woo-Kim/AmplifyQuery/compare/v1.0.5...v1.0.6) (2025-06-15)


### fix

* chore(release): 1.0.0 [skip ci] ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/f377e1269d8b77f98fe528a27c6355b49c4aa75f))
* feat: improve readme ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/004de5a47a17c4c6b95ec5de1751747c11ca35ac))
* feat: update releaserc ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/af7b3ae024c4b8dd029cbedd24b5dee0dc489025))
* fix: modify commit transformation logic in releaserc ([](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/51277b1c1cee5dbece3024814649ec0a8623556e))

# 1.0.0 (2025-06-15)


### Features

* improve readme ([004de5a](https://github.com/Sun-Woo-Kim/AmplifyQuery/commit/004de5a47a17c4c6b95ec5de1751747c11ca35ac))
