export interface GeneratedQuestion {
  subject: string;
  conceptNodeId: number | null;
  stem: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  sourceDetail: Record<string, unknown>;
}
