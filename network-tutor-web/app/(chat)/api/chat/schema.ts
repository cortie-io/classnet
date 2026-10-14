import { z } from "zod";

const textPartSchema = z.object({
  text: z.string().min(1).max(2000),
  type: z.enum(["text"]),
});

const filePartSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  type: z.enum(["file"]),
  url: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.uuid(),
  parts: z.array(partSchema).min(1).max(8),
  role: z.enum(["user"]),
});

export const postRequestBodySchema = z.object({
  id: z.uuid(),
  message: userMessageSchema,
  selectedChatModel: z.enum(["network-tutor-gemma", "network-tutor-openai"]),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
