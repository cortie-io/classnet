// 동시 실행 개수를 제한하는 최소 세마포어. 한도를 넘는 요청은 실패시키지 않고 대기열에 줄을 세운다 —
// 여러 학생이 동시에 몰려도 다들 한꺼번에 부딪혀 같이 느려지거나 타임아웃나는 대신, 순서대로 안정적으로
// 끝까지 처리되게 하기 위함이다(공유 Ollama 인스턴스 하나를 여러 학생이 나눠 쓰는 구조라 필요).
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number {
    return this.queue.length;
  }
}
