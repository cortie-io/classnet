import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { networkTutorModel } from "./network-tutor-model";

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(_modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("chat-model");
  }
  // 모델 ID(network-tutor-gemma / network-tutor-openai)는 route.ts에서
  // providerOptions.networkTutor.useOwnKey로만 구분해 백엔드에 전달한다 — 실제로 어떤 provider를
  // 쓸지는 우리 Express 백엔드가 결정하므로 여기서는 항상 같은 어댑터를 반환한다.
  return networkTutorModel;
}
