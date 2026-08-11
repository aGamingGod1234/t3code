import { describe, expect, it } from "vite-plus/test";

import { extractKimiUserQuestions } from "./KimiUserInput.ts";

describe("extractKimiUserQuestions", () => {
  it("parses Kimi AskUserQuestion input", () => {
    expect(
      extractKimiUserQuestions({
        questions: [
          {
            id: "framework",
            header: "Framework",
            question: "Which framework should I use?",
            options: [
              { label: "React", description: "Use React." },
              { label: "Vue", description: "Use Vue." },
            ],
            multi_select: false,
          },
        ],
      }),
    ).toEqual([
      {
        id: "framework",
        header: "Framework",
        question: "Which framework should I use?",
        options: [
          { label: "React", description: "Use React." },
          { label: "Vue", description: "Use Vue." },
        ],
        multiSelect: false,
      },
    ]);
  });

  it("derives stable ids and trims fields", () => {
    expect(
      extractKimiUserQuestions({
        questions: [
          {
            header: "  Database  ",
            question: "  Which database? ",
            options: [" Postgres ", " SQLite "],
          },
        ],
      }),
    ).toEqual([
      {
        id: "kimi-question-1-database",
        header: "Database",
        question: "Which database?",
        options: [
          { label: "Postgres", description: "Postgres" },
          { label: "SQLite", description: "SQLite" },
        ],
        multiSelect: false,
      },
    ]);
  });

  it.each([
    undefined,
    {},
    { questions: [] },
    { questions: [{ header: "X", question: "Choose", options: [{ label: "Only" }] }] },
    {
      questions: [
        { header: "X", question: "Choose", options: [{ label: "" }, { label: "Valid" }] },
      ],
    },
    { tool: "shell", input: { command: "pwd" } },
  ])("rejects malformed or non-question input %#", (input) => {
    expect(extractKimiUserQuestions(input)).toBeUndefined();
  });
});
