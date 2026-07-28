export interface TerminalEchoInputToken {
  id: number;
  previousToken: number | null;
}

export class TerminalEchoPaintController {
  private awaitingEchoToken: number | null = null;
  private nextToken = 1;

  beginInput(): TerminalEchoInputToken {
    const token = {
      id: this.nextToken,
      previousToken: this.awaitingEchoToken,
    };
    this.nextToken += 1;
    this.awaitingEchoToken = token.id;
    return token;
  }

  rejectInput(token: TerminalEchoInputToken): void {
    if (this.awaitingEchoToken === token.id) {
      this.awaitingEchoToken = token.previousToken;
    }
  }

  renderFirstOutput(render: () => void): boolean {
    if (this.awaitingEchoToken === null) return false;
    this.awaitingEchoToken = null;
    render();
    return true;
  }

  reset(): void {
    this.awaitingEchoToken = null;
  }
}
