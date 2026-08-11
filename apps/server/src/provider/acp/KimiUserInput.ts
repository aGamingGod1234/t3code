import type { UserInputQuestion } from "@t3tools/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function option(value: unknown): UserInputQuestion["options"][number] | undefined {
  if (typeof value === "string") {
    const label = text(value);
    return label ? { label, description: label } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const label = text(value.label);
  if (!label) return undefined;
  return { label, description: text(value.description) ?? label };
}

function stableQuestionId(index: number, header: string): string {
  const slug = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `kimi-question-${index + 1}${slug ? `-${slug}` : ""}`;
}

export function extractKimiUserQuestions(
  input: unknown,
): ReadonlyArray<UserInputQuestion> | undefined {
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length === 0) {
    return undefined;
  }

  const questions: UserInputQuestion[] = [];
  for (const [index, value] of input.questions.entries()) {
    if (!isRecord(value) || !Array.isArray(value.options)) return undefined;
    const header = text(value.header);
    const question = text(value.question);
    if (!header || !question) return undefined;
    const options = value.options.map(option);
    if (options.length < 2 || options.some((entry) => entry === undefined)) return undefined;

    questions.push({
      id: text(value.id) ?? stableQuestionId(index, header),
      header,
      question,
      options: options as Array<UserInputQuestion["options"][number]>,
      multiSelect: value.multi_select === true || value.multiSelect === true,
    });
  }

  return questions;
}
