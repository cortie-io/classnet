서버를 맡으면 "지금 무엇이 돌고 있나, 멈춘 프로그램은 어떻게 끝내나, 서비스는 부팅 때 자동으로 켜지나, 디스크는 넉넉한가"를 늘 살펴야 해요. 이 단원에서는 프로세스를 보고 다루는 명령, systemd로 서비스를 관리하는 법, 정해진 시각에 작업을 돌리는 cron, 프로그램을 설치하는 패키지 관리, 디스크와 로그 관리까지 서버 관리자의 일상 도구를 한꺼번에 익혀요.

> [!GOAL]
> - `ps`·`top`·`kill`로 프로세스를 확인하고 주요 시그널 번호의 의미를 말할 수 있다.
> - `systemctl`로 서비스를 시작·중지·자동 시작 설정하고, `journalctl`로 로그를 볼 수 있다.
> - crontab의 다섯 시간 필드를 읽고 쓸 수 있다.
> - rpm·dnf(yum)·dpkg·apt를 구분하고, 디스크·메모리·로그를 점검하는 명령을 쓸 수 있다.

## 프로세스의 기본

**프로세스**(Process)는 실행 중인 프로그램이에요. 디스크에 저장된 `/usr/bin/vi` 파일은 프로그램이고, 그것을 실행해 메모리에 올라와 움직이는 것이 프로세스예요. 같은 프로그램을 세 번 실행하면 프로세스가 세 개 생겨요. 일반적인 개념은 [운영체제와 네트워크 운영체제](/textbook/nos-os-basics)에서 배웠어요.

- **PID(Process ID)**: 프로세스마다 붙는 고유 번호
- **PPID(Parent PID)**: 나를 실행시킨 부모 프로세스의 번호
- 모든 프로세스는 부모-자식 관계로 이어진 나무 구조이고, 맨 꼭대기는 **PID 1번인 systemd**(예전에는 init)예요.
- **데몬(Daemon)**: 화면 없이 뒤에서 계속 돌며 서비스를 제공하는 프로세스. `sshd`, `httpd`, `crond`처럼 이름이 d로 끝나는 경우가 많아요.

| 용어 | 뜻 |
|---|---|
| 포그라운드(Foreground) | 터미널을 차지하고 실행되어, 끝날 때까지 다른 명령을 입력할 수 없는 작업 |
| 백그라운드(Background) | 뒤에서 실행되어, 그동안 터미널에서 다른 명령을 입력할 수 있는 작업 |
| 좀비(Zombie) 프로세스 | 이미 끝났지만 부모가 종료 결과를 거두어 가지 않아 목록에 이름만 남은 프로세스 |
| 고아(Orphan) 프로세스 | 부모가 먼저 끝나 버린 프로세스. systemd(init)가 새 부모가 되어 거둬 줘요 |

## 프로세스 보기

### ps — 지금 이 순간의 목록

| 명령 | 뜻 |
|---|---|
| `ps` | 현재 터미널에서 내가 실행한 프로세스만 |
| `ps aux` | 시스템의 모든 프로세스를 사용자 중심 형식으로(BSD 방식: `a` 모든 사용자, `u` 사용자 형식, `x` 터미널 없는 프로세스 포함) |
| `ps -ef` | 시스템의 모든 프로세스를 전체 형식으로(System V 방식: `-e` 모두, `-f` 자세히). **PPID** 열이 보여요 |

```text
$ ps aux | head -3
USER   PID %CPU %MEM    VSZ   RSS TTY  STAT START  TIME COMMAND
root     1  0.0  0.3 171820 12900 ?    Ss   09:00  0:02 /usr/lib/systemd/systemd
root   812  0.0  0.2  15840  9120 ?    Ss   09:00  0:00 sshd: /usr/sbin/sshd -D

$ ps -ef        (제목 줄과 httpd 부분만 발췌)
UID     PID  PPID  C STIME TTY      TIME CMD
root   1203     1  0 09:01 ?    00:00:00 /usr/sbin/httpd -DFOREGROUND
apache 1210  1203  0 09:01 ?    00:00:00 /usr/sbin/httpd -DFOREGROUND
```

두 번째 예에서 PID 1210의 PPID가 1203이니, 1203번 httpd가 1210번을 낳은 부모예요. `TTY`가 `?`인 것은 터미널과 연결되지 않은 데몬이라는 뜻이에요.

`STAT` 열의 주요 상태 글자는 이래요.

| 글자 | 상태 |
|---|---|
| `R` | 실행 중이거나 실행 대기(Running) |
| `S` | 잠든 상태, 깨울 수 있음(Sleeping) |
| `D` | 깨울 수 없는 대기, 주로 디스크 입출력 대기 |
| `T` | 정지됨(Stopped) |
| `Z` | 좀비(Zombie) |

### top, pstree, pgrep

- **`top`** — 프로세스 상태를 몇 초마다 새로 고쳐 실시간으로 보여 줘요. 위쪽에는 가동 시간, 평균 부하(load average), CPU와 메모리 사용률이 나와요. 실행 중에 `P`는 CPU 사용률 순, `M`은 메모리 순 정렬, `k`는 프로세스 종료, `r`은 우선순위 변경, `q`는 끝내기예요.
- **`pstree`** — 부모-자식 관계를 나무 모양으로 보여 줘요. `pstree -p`는 PID도 함께 표시해요.
- **`pgrep sshd`** — 이름으로 PID를 찾아요.

## 시그널과 kill

### 시그널이란

**시그널**(Signal)은 운영체제가 프로세스에게 보내는 짧은 신호예요. "이제 그만 끝내 줄래?", "당장 멈춰!", "설정 파일 다시 읽어" 같은 메시지를 번호로 전달해요. `kill -l`로 전체 목록을 볼 수 있어요.

| 번호 | 이름 | 뜻 |
|---|---|---|
| 1 | SIGHUP | 터미널 연결이 끊김(Hang Up). 많은 데몬은 이 신호를 받으면 **설정 파일을 다시 읽어요** |
| 2 | SIGINT | 인터럽트. 키보드에서 `Ctrl + C`를 누른 것과 같아요 |
| 9 | SIGKILL | **강제 종료**. 프로세스가 무시하거나 가로챌 수 없어요 |
| 15 | SIGTERM | **정상 종료 요청**. `kill`의 기본값. 프로세스가 정리 작업을 하고 끝날 수 있어요 |
| 18 | SIGCONT | 정지된 프로세스를 다시 계속(Continue) |
| 19 | SIGSTOP | 일시 정지. 무시할 수 없어요 |
| 20 | SIGTSTP | 터미널에서 `Ctrl + Z`를 눌러 정지 |

> [!NOTE]
> 18·19·20번은 일반 PC와 서버(x86, ARM)의 리눅스 기준 번호예요. 다른 CPU 구조에서는 번호가 다를 수 있어서, 스크립트에서는 번호 대신 `-STOP`, `-CONT`처럼 이름을 쓰는 편이 안전해요. 1, 2, 9, 15는 어디서나 같아요.

### kill, killall, pkill

```bash
kill 1203              # SIGTERM(15)으로 정상 종료 요청
kill -15 1203          # 위와 같음
kill -9 1203           # 응답이 없을 때 강제 종료 (kill -KILL 1203 도 같음)
kill -HUP 1203         # 재시작 없이 설정 다시 읽기 요청 (kill -1 1203)
killall httpd          # 이름이 httpd인 프로세스를 모두 종료
pkill -u jiwoo         # jiwoo 사용자의 프로세스 종료
pkill -9 -f backup.sh  # 명령줄에 backup.sh가 들어간 프로세스 강제 종료
```

> [!TIP]
> 종료는 순한 것부터: 먼저 `kill PID`(15)로 정중히 부탁하고, 그래도 안 끝나면 `kill -9 PID`로 강제로 끝내요. 9번은 정리 작업 없이 바로 끊기 때문에 작업 중이던 데이터가 깨질 수 있어요.

> [!EXAM]
> "강제 종료 시그널 번호" → 9(SIGKILL), "kill의 기본 시그널" → 15(SIGTERM), "Ctrl + C" → 2(SIGINT), "설정 다시 읽기에 쓰는 시그널" → 1(SIGHUP). 이 네 개는 꼭 외워 두세요.

## 우선순위: nice와 renice

CPU를 누구에게 먼저 줄지는 **nice 값**으로 조절해요. 범위는 **-20부터 19까지**이고, -20이 가장 높은 우선순위, 19가 가장 낮은 우선순위예요. 기본값은 0이에요. 이름처럼 "착할수록(nice 값이 클수록)" 다른 프로세스에 CPU를 양보해요.

```bash
nice -n 10 ./report.sh        # nice 값 10으로(우선순위를 낮춰서) 실행
renice -n 5 -p 2048           # 실행 중인 PID 2048의 nice 값을 5로
renice -n -5 -p 2048          # 음수(우선순위 높이기)는 root만 가능
```

- `nice`는 **새로 실행할** 명령에, `renice`는 **이미 실행 중인** 프로세스에 써요.
- 일반 사용자는 nice 값을 올리는 것(양보하는 것)만 할 수 있어요.
- `top`의 `NI` 열에서 nice 값을 볼 수 있어요.

## 작업 제어: &, jobs, fg, bg, nohup

시간이 오래 걸리는 명령을 실행하면서 터미널을 계속 쓰고 싶을 때 쓰는 기능이에요.

```text
$ ./backup.sh &          ← 처음부터 백그라운드로 실행
[1] 3051                 ← [작업 번호] PID
$ vi notes.txt           ← 편집하다가 Ctrl + Z
[2]+  Stopped   vi notes.txt
$ jobs                   ← 현재 셸의 작업 목록
[1]-  Running   ./backup.sh &
[2]+  Stopped   vi notes.txt
$ fg %2                  ← 2번 작업을 포그라운드로 다시 가져오기
$ bg %2                  ← (정지된 작업을) 백그라운드에서 계속 실행
```

| 명령 | 하는 일 |
|---|---|
| `명령 &` | 백그라운드로 실행 |
| `Ctrl + Z` | 포그라운드 작업 일시 정지 |
| `jobs` | 작업 목록 |
| `fg %번호` | 포그라운드로 |
| `bg %번호` | 정지된 작업을 백그라운드에서 계속 |
| `nohup 명령 &` | 로그아웃해도(SIGHUP을 받아도) 계속 실행. 출력은 `nohup.out`에 저장 |

## 서비스 관리: systemctl과 journalctl

### systemctl

systemd는 서비스, 마운트, 타깃 같은 관리 대상을 **유닛**(Unit)이라고 불러요. 서비스 유닛은 `sshd.service`처럼 이름이 `.service`로 끝나고, 명령에서는 `.service`를 생략해도 돼요.

| 명령 | 하는 일 |
|---|---|
| `systemctl start httpd` | 지금 시작 |
| `systemctl stop httpd` | 지금 중지 |
| `systemctl restart httpd` | 중지 후 다시 시작 |
| `systemctl reload httpd` | 멈추지 않고 설정만 다시 읽기(지원하는 서비스만) |
| `systemctl status httpd` | 실행 상태, PID, 최근 로그 확인 |
| `systemctl enable httpd` | **부팅할 때 자동 시작**하도록 등록 |
| `systemctl disable httpd` | 자동 시작 해제 |
| `systemctl enable --now httpd` | 자동 시작 등록과 지금 시작을 한 번에 |
| `systemctl is-active httpd` / `is-enabled httpd` | 실행 중인지 / 자동 시작인지 짧게 확인 |
| `systemctl list-units --type=service` | 서비스 목록 |

> [!WARNING]
> `start`는 "지금 켜기"이고 `enable`은 "다음 부팅부터 자동으로 켜기"예요. `enable`만 하면 지금은 꺼진 채이고, `start`만 하면 재부팅 후 꺼져 있어요. 둘 다 원하면 `enable --now`를 써요. systemd 이전에는 `service httpd start`(시작)와 `chkconfig httpd on`(자동 시작)을 썼어요.

### journalctl

systemd는 서비스와 커널의 로그를 **저널**(journal)이라는 곳에 모아요. `journalctl`로 이 로그를 골라 볼 수 있어요.

```bash
journalctl                   # 전체 로그(오래된 것부터)
journalctl -u sshd           # 특정 유닛의 로그만
journalctl -f                # 새 로그를 실시간으로 (tail -f 처럼)
journalctl -b                # 이번 부팅 이후의 로그
journalctl -p err            # 오류(err) 이상 중요도만
journalctl --since today     # 오늘 생긴 로그만
```

## 예약 작업: cron과 at

### cron — 반복 작업

**cron**은 정해진 시각마다 명령을 반복 실행해 주는 예약 서비스예요(레드햇 계열 데몬 이름 `crond`, 데비안 계열 `cron`). 사용자마다 자기 예약 목록인 **crontab**을 가져요.

| 명령 | 하는 일 |
|---|---|
| `crontab -e` | 내 예약 목록 편집 |
| `crontab -l` | 내 예약 목록 보기 |
| `crontab -r` | 내 예약 목록 **전체 삭제** |
| `crontab -u jiwoo -l` | (root가) 다른 사용자의 목록 보기 |

crontab의 한 줄은 **시간 필드 다섯 개 + 실행할 명령**이에요.

```text
분   시   일   월   요일   명령
0-59 0-23 1-31 1-12 0-7
```

| 기호 | 뜻 | 예 |
|---|---|---|
| `*` | 모든 값 | 매시, 매일… |
| `,` | 여러 값 나열 | `1,15` |
| `-` | 범위 | `1-5` |
| `*/n` | n마다 | `*/10` |

요일은 0과 7이 일요일, 1이 월요일, 6이 토요일이에요.

### 단계별 예제

| crontab 줄 | 읽는 법 |
|---|---|
| `30 2 * * * /root/backup.sh` | 매일 02:30 |
| `0 9 * * 1-5 /root/report.sh` | 월~금요일 09:00 |
| `*/10 * * * * /root/check.sh` | 10분마다 |
| `0 0 1 * * /root/monthly.sh` | 매월 1일 00:00 |
| `0 18 * * 0 /root/weekly.sh` | 매주 일요일 18:00 |
| `15 3 1,15 * * /root/clean.sh` | 매월 1일과 15일 03:15 |
| `0 */2 * * * /root/sync.sh` | 2시간마다 정각(0시, 2시, 4시…) |

`0 9 * * 1-5`를 왼쪽부터 읽어 볼게요. 분 = 0, 시 = 9 → 9시 0분. 일 = 아무 날, 월 = 아무 달, 요일 = 1~5(월~금). 그래서 "평일 오전 9시 정각"이에요.

일과 요일 칸을 **둘 다** 지정하면 "그리고"가 아니라 "또는"으로 동작해요. 예를 들어 `0 9 13 * 5`는 "13일이면서 금요일"이 아니라 "매월 13일, 그리고 매주 금요일"의 9시에 실행돼요.

> [!WARNING]
> 첫 칸은 **분**, 둘째 칸이 **시**예요. `2 30 * * *`처럼 거꾸로 쓰면 시 자리에 30이 들어가 잘못된 줄이 돼요. 또 `* 2 * * *`는 "매일 2시대의 매 분", 즉 2:00부터 2:59까지 60번 실행이니, 한 번만 원하면 분을 `0`처럼 꼭 정해 주세요.

> [!NOTE]
> 시스템 전체 예약은 `/etc/crontab`과 `/etc/cron.d/`에 두는데, 이 파일들은 요일과 명령 사이에 **실행할 사용자** 필드가 하나 더 있어요. `/etc/cron.daily/` 같은 디렉터리에 스크립트를 넣으면 하루에 한 번 실행돼요. cron 사용을 허락하거나 막는 목록은 `/etc/cron.allow`와 `/etc/cron.deny`예요.

### at — 한 번만 실행

```text
$ at 23:00                ← 23시에 한 번 실행(이미 지났으면 다음 날)
at> /root/backup.sh       ← 실행할 명령 입력
at> (Ctrl + D)            ← 입력 끝
$ at now + 30 minutes     ← 30분 뒤에 한 번
$ atq                     ← 예약 목록
$ atrm 3                  ← 3번 예약 삭제
```

`at`은 `atd` 서비스가 실행 중이어야 동작해요. 반복은 cron, 한 번은 at으로 구분해 두세요.

## 패키지 관리

**패키지**(Package)는 프로그램 파일, 설정 파일, 설치 정보를 하나로 묶은 설치 꾸러미예요. 어떤 패키지는 다른 패키지가 먼저 있어야 동작하는데, 이 관계를 **의존성**(Dependency)이라고 해요.

### 레드햇 계열: rpm, yum, dnf

`rpm`은 패키지 파일 하나를 직접 설치·조회하는 저수준 도구예요. 의존성을 자동으로 해결하지 않아요.

| 명령 | 하는 일 |
|---|---|
| `rpm -ivh 파일.rpm` | 설치(`i` 설치, `v` 자세히, `h` 진행 막대 #) |
| `rpm -Uvh 파일.rpm` | 업그레이드(없으면 설치) |
| `rpm -e 패키지` | 삭제(erase) |
| `rpm -qa` | 설치된 패키지 전체 목록(query all) |
| `rpm -qi 패키지` | 패키지 정보 |
| `rpm -ql 패키지` | 패키지가 설치한 파일 목록 |
| `rpm -qf /경로/파일` | 이 파일이 어느 패키지에서 왔는지 |

`yum`과 그 후속인 `dnf`는 저장소(Repository)에서 패키지를 내려받고 **의존성까지 자동으로** 설치해 줘요. RHEL 8 이후에는 `dnf`가 기본이고, `yum`이라고 입력해도 dnf가 동작해요. 저장소 설정은 `/etc/yum.repos.d/`에 있어요.

### 데비안 계열: dpkg, apt

| 명령 | 하는 일 |
|---|---|
| `dpkg -i 파일.deb` | 설치 |
| `dpkg -r 패키지` | 삭제(설정 파일은 남김) |
| `dpkg -P 패키지` | 설정 파일까지 완전 삭제(purge) |
| `dpkg -l` | 설치된 패키지 목록 |
| `dpkg -L 패키지` | 패키지가 설치한 파일 목록 |

`apt`(또는 `apt-get`)가 dnf와 같은 역할을 해요. 저장소 목록은 `/etc/apt/sources.list`와 `/etc/apt/sources.list.d/`에 있어요.

### 한눈에 비교

| 할 일 | 레드햇 계열 | 데비안 계열 |
|---|---|---|
| 저장소에서 설치 | `dnf install httpd` (`yum install`) | `apt install apache2` |
| 삭제 | `dnf remove httpd` | `apt remove apache2` |
| 전체 업데이트 | `dnf upgrade` (`yum update`) | `apt update` 후 `apt upgrade` |
| 검색 | `dnf search 단어` | `apt search 단어` |
| 정보 | `dnf info httpd` | `apt show apache2` |
| 패키지 파일 직접 설치 | `rpm -ivh x.rpm` | `dpkg -i x.deb` |
| 설치 목록 | `rpm -qa` | `dpkg -l` |

> [!WARNING]
> `apt update`는 "저장소의 패키지 목록을 새로 받아 오기"만 하고, 실제 업그레이드는 `apt upgrade`가 해요. 반면 `yum update`는 실제로 패키지를 업데이트해요. 이름이 비슷해서 헷갈리기 쉬워요.

## 디스크와 파일 시스템

### 장치 이름

디스크도 `/dev` 아래에 파일처럼 나타나요.

| 장치 이름 | 뜻 |
|---|---|
| `/dev/sda`, `/dev/sdb` | 첫 번째, 두 번째 SATA·SCSI·USB 디스크 |
| `/dev/sda1`, `/dev/sda2` | `sda` 디스크의 1번, 2번 파티션 |
| `/dev/nvme0n1p1` | NVMe SSD의 1번 파티션 |
| `/dev/vda` | 가상 머신의 가상 디스크 |
| `/dev/hda` | 아주 오래된 IDE 디스크 |

### 용량 확인과 파일 시스템 만들기

| 명령 | 하는 일 |
|---|---|
| `df -h` | 마운트된 파일 시스템별 전체·사용·남은 용량(disk free). `-T`는 파일 시스템 종류도 |
| `du -sh /var/log` | 디렉터리가 차지한 용량 합계(disk usage). `-s` 합계만, `-h` 읽기 쉽게 |
| `fdisk -l` | 디스크와 파티션 목록(root 필요). `fdisk /dev/sdb`는 파티션 편집 |
| `lsblk` | 블록 장치를 나무 모양으로 |
| `mkfs -t ext4 /dev/sdb1` | 파티션에 ext4 파일 시스템 만들기(포맷). `mkfs.xfs /dev/sdb1`처럼도 써요 |
| `mkswap /dev/sdb2`, `swapon /dev/sdb2` | 스왑 영역 만들고 켜기 |
| `fsck /dev/sdb1` | 파일 시스템 검사·복구(마운트를 해제한 상태에서) |

리눅스의 대표 파일 시스템은 ext 계열(ext2 → 저널링이 추가된 ext3 → ext4)과 XFS예요. RHEL 7 이후의 기본은 XFS, 데비안·우분투의 기본은 ext4예요.

### mount와 /etc/fstab

```bash
mkdir /data
mount /dev/sdb1 /data              # sdb1을 /data에 붙이기
mount -t ext4 /dev/sdb1 /data      # 파일 시스템 종류를 직접 지정
mount                              # 현재 마운트 목록
umount /data                       # 떼어 내기 (unmount가 아니라 umount)
```

`mount` 명령으로 붙인 것은 재부팅하면 풀려요. 부팅할 때마다 자동으로 붙이려면 **`/etc/fstab`** 파일에 한 줄을 적어요. 이 파일은 공백으로 구분된 **6개 필드**예요.

```text
/dev/sdb1   /data   ext4   defaults   0   2
```

| 순서 | 값 | 필드 |
|---|---|---|
| 1 | `/dev/sdb1` | 장치. `UUID=...`나 `LABEL=...`로 적는 것이 더 안전해요(`blkid`로 확인) |
| 2 | `/data` | 마운트 지점 |
| 3 | `ext4` | 파일 시스템 종류(`xfs`, `nfs`, `swap` 등) |
| 4 | `defaults` | 마운트 옵션(`ro` 읽기 전용, `noauto` 자동 마운트 안 함 등) |
| 5 | `0` | dump 백업 대상 여부(0 = 안 함) |
| 6 | `2` | 부팅 때 fsck 검사 순서(0 = 안 함, 1 = 루트, 2 = 그 밖) |

고친 뒤에는 `mount -a`로 fstab의 내용을 모두 마운트해 보고 오류가 없는지 확인해요. fstab에 오타가 있으면 다음 부팅이 멈출 수 있어요.

### 메모리와 가동 시간

```text
$ free -h
               total   used   free  shared  buff/cache  available
Mem:           7.6Gi  2.1Gi  3.0Gi   120Mi       2.5Gi      5.2Gi
Swap:          2.0Gi     0B  2.0Gi

$ uptime
 14:32:10 up 12 days,  3:41,  2 users,  load average: 0.15, 0.20, 0.18
```

- `free`의 `available`이 새 프로그램에 실제로 줄 수 있는 메모리에 가까워요. `buff/cache`는 필요하면 비워 줄 수 있는 캐시예요.
- `uptime`은 현재 시각, 켜진 지 얼마나 됐는지, 로그인 사용자 수, 그리고 1분·5분·15분 **평균 부하**(load average)를 보여 줘요.

## 로그 파일

로그는 장애 원인을 찾는 가장 중요한 단서예요. 대부분 `/var/log`에 있고, 배포판 계열에 따라 파일 이름이 달라요.

| 내용 | 레드햇 계열 | 데비안 계열 |
|---|---|---|
| 일반 시스템 메시지 | `/var/log/messages` | `/var/log/syslog` |
| 인증·보안(로그인, su, sudo, sshd) | `/var/log/secure` | `/var/log/auth.log` |
| cron 실행 기록 | `/var/log/cron` | `syslog` 안에 함께 |
| 메일 | `/var/log/maillog` | `/var/log/mail.log` |

그 밖에 알아 둘 것들이에요.

- **`dmesg`** — 커널이 남긴 메시지(부팅 때의 하드웨어 인식, 드라이버 오류 등)를 보여 주는 명령이에요. 일부 배포판은 부팅 시 메시지를 `/var/log/dmesg` 파일로도 남겨요.
- **`/var/log/boot.log`** — 부팅 중 서비스 시작 메시지(레드햇 계열).
- **`/var/log/wtmp`** — 로그인·로그아웃 기록. 바이너리 파일이라 `last` 명령으로 봐요. 로그인 **실패** 기록은 `/var/log/btmp`이고 `lastb`로 봐요.
- **`lastlog`** — 사용자별 마지막 로그인 시각.
- 로그를 모아 파일에 쓰는 서비스는 **rsyslog**(설정 `/etc/rsyslog.conf`)이고, 오래된 로그를 날짜별로 잘라 압축·삭제하는 도구는 **logrotate**(설정 `/etc/logrotate.conf`)예요.

> [!NOTE]
> 최근 일부 배포판은 rsyslog를 기본 설치하지 않아서 `/var/log/messages`나 `/var/log/syslog` 파일이 없을 수 있어요. 그럴 때는 `journalctl`로 같은 내용을 볼 수 있어요.

## 핵심 정리

- 프로세스는 실행 중인 프로그램, PID는 고유 번호, PPID는 부모 번호, PID 1은 systemd(예전 init).
- `ps aux`, `ps -ef`(PPID 확인), 실시간은 `top`, 나무 구조는 `pstree`.
- 시그널: 1 HUP(설정 다시 읽기), 2 INT(`Ctrl + C`), 9 KILL(강제), 15 TERM(기본, 정상 종료), STOP/CONT는 정지/계속.
- nice 값은 -20(높음)~19(낮음), 새 명령은 `nice`, 실행 중이면 `renice`, 음수는 root만.
- `&` 백그라운드, `Ctrl + Z` 정지, `jobs`/`fg`/`bg`, 로그아웃 후에도 계속하려면 `nohup`.
- `systemctl start/stop/restart/status`, 부팅 시 자동 시작은 `enable`, 로그는 `journalctl -u 서비스`.
- crontab은 `분 시 일 월 요일 명령`, `-e` 편집 `-l` 보기 `-r` 전체 삭제, 한 번만은 `at`.
- 레드햇: `rpm -ivh/-e/-qa`, `dnf`(`yum`) / 데비안: `dpkg -i/-r/-l`, `apt`.
- `df -h` 파일 시스템 용량, `du -sh` 디렉터리 용량, `mount`/`umount`, `/etc/fstab` 6필드.
- 로그: `/var/log/messages`(데비안 `syslog`), `/var/log/secure`(데비안 `auth.log`), 커널 메시지는 `dmesg`.

## 스스로 확인하기

**1.** 응답이 없는 프로세스(PID 4120)를 정리 작업 기회 없이 즉시 끝내려고 해요. 알맞은 명령은?
① `kill 4120` ② `kill -1 4120` ③ `kill -9 4120` ④ `kill -18 4120`

> [!ANSWER]
> 정답: ③
> 9번 SIGKILL은 프로세스가 무시할 수 없는 강제 종료예요. 옵션 없는 `kill`은 15번(정상 종료 요청), 1번은 HUP, 18번은 CONT예요.

**2.** crontab에 `20 4 * * 6 /root/archive.sh`라고 적었어요. 이 작업은 언제 실행될까요?
① 매일 04:20 ② 매주 토요일 04:20 ③ 매월 6일 04:20 ④ 매주 토요일 20:04

> [!ANSWER]
> 정답: ②
> 순서가 분(20) 시(4) 일(*) 월(*) 요일(6)이고, 요일 6은 토요일이에요.

**3.** 웹 서버 httpd가 다음 부팅부터 자동으로 시작되도록 하면서 지금 당장도 실행하려면?
① `systemctl start httpd` ② `systemctl enable httpd` ③ `systemctl enable --now httpd` ④ `systemctl reload httpd`

> [!ANSWER]
> 정답: ③
> `enable`은 자동 시작 등록만, `start`는 지금 실행만 해요. `enable --now`는 두 가지를 한 번에 해요.

**4.** 레드햇 계열 서버에서 `/etc/ssh/sshd_config` 파일이 어느 패키지에 속하는지 알아보는 명령은?
① `rpm -qa sshd_config` ② `rpm -qf /etc/ssh/sshd_config` ③ `dpkg -L /etc/ssh/sshd_config` ④ `rpm -e /etc/ssh/sshd_config`

> [!ANSWER]
> 정답: ②
> `rpm -qf`는 파일 경로로 그 파일을 설치한 패키지를 찾아요. `dpkg`는 데비안 계열 도구이고, `rpm -e`는 삭제예요.

**5.** `/etc/fstab`의 한 줄 `UUID=7d2e...  /backup  xfs  defaults  0  0`에 대한 설명으로 옳지 않은 것은?
① 마운트 지점은 /backup이다 ② 파일 시스템 종류는 xfs이다 ③ 부팅할 때 fsck 검사를 하지 않는다 ④ 이 장치는 읽기 전용으로 마운트된다

> [!ANSWER]
> 정답: ④
> 옵션이 `defaults`이므로 읽고 쓰기가 모두 되는 기본 설정이에요. 읽기 전용이라면 `ro`가 들어가야 해요. 마지막 0은 fsck 검사를 하지 않는다는 뜻이에요.
