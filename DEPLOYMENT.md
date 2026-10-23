# Classnet 운영 배포 메모 (2026-10-16)

현재 운영 계열은 classnet-tutor-codex의 7b4f9c8 기반입니다.
classnet-tutor의 44798a1 및 .env.docker는 동결된 1차 DB를 가리키는 이전 설정입니다.
이 경로에서 cortie deploy classnet-tutor를 실행하면 정상 2차 서비스 설정을 덮어쓰므로 사용하지 마세요.

이번 CSV 이메일 선택 변경의 검증된 빌드 소스: /home/ubuntu/projects/classnet-csv-email-20261016
이미지 태그: cortie/network-tutor-{server,web}:csv-email-20261016
운영 compose: beta /home/ubuntu/projects/classnet-tutor/docker-compose.yml
운영 DB: network_tutor_phase2. 1차 DB는 읽기 전용 보존.
배포 시 beta의 현재 compose 환경을 보존하고 이미지 태그만 바꾸세요.
기존 사용자 작업 파일은 유지됩니다.

## 2026-10-19 명칭 수정 배포
현재 웹 이미지: cortie/network-tutor-web:study-label-20261019
웹 빌드 소스: /home/ubuntu/projects/classnet-study-label-20261019/network-tutor-web
서버는 csv-email-20261016 유지. beta의 환경 설정을 보존하고 해당 웹 이미지만 교체함.

## 2026-10-20 정규 시작 정책
기존 2차 학생 데이터 전체 보존. service_launch=official. 유제현(id57)의 학습 기록만 요청에 따라 초기화하고 계정·비밀번호·반은 보존.
beta /var/lib/classnet-launch/reset.sql은 이제 기록을 삭제하지 않고 정규 상태만 전환함. 소스 launch 테스트는 모든 public 테이블 보존을 검사함.
정규 시작 전 백업: alpha /var/backups/cortie-db/classnet-before-official-preserve-20261020.dump
