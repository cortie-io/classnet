// 과목 값("2과목_TCP_IP")을 화면용 이름("TCP/IP")으로. 예전엔 화면마다 "N과목_"만 떼어 "TCP_IP",
// "네트워크_일반"처럼 밑줄이 그대로 보였다.
export function subjectLabel(subject: string): string {
  const name = subject.replace(/^\d과목_/, "");
  return name === "TCP_IP" ? "TCP/IP" : name.replace(/_/g, " ");
}
