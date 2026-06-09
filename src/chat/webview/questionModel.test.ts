/**
 * Behavioral tests for the pure question-args normalizer.
 *
 * The `question` tool input arrives in more than one shape depending on the
 * model/provider. parseQuestionArgs must collapse both the flat single-question
 * shape and the Claude-style nested `questions[]` shape into QuestionGroup[],
 * and must return [] (not a blank group) for partial/empty input so the live
 * renderer doesn't wipe an already-shown question.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseQuestionArgs, parseAllowFreeText, toOptionLabels } from "./questionModel"

describe("parseQuestionArgs — flat shape", () => {
  it("parses question + options", () => {
    const groups = parseQuestionArgs({ question: "Pick a DB", options: ["Postgres", "MySQL"] })
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.question, "Pick a DB")
    assert.deepEqual(groups[0]!.options, ["Postgres", "MySQL"])
    assert.equal(groups[0]!.multiSelect, false)
  })

  it("accepts prompt/message/text aliases for the question", () => {
    assert.equal(parseQuestionArgs({ prompt: "P?" })[0]!.question, "P?")
    assert.equal(parseQuestionArgs({ message: "M?" })[0]!.question, "M?")
    assert.equal(parseQuestionArgs({ text: "T?" })[0]!.question, "T?")
  })

  it("accepts choices/select aliases for options", () => {
    assert.deepEqual(parseQuestionArgs({ question: "q", choices: ["a", "b"] })[0]!.options, ["a", "b"])
    assert.deepEqual(parseQuestionArgs({ question: "q", select: ["x"] })[0]!.options, ["x"])
  })

  it("honors a flat multiSelect flag", () => {
    assert.equal(parseQuestionArgs({ question: "q", options: ["a"], multiSelect: true })[0]!.multiSelect, true)
  })

  it("returns a group when only options are present (no question text yet)", () => {
    const groups = parseQuestionArgs({ options: ["a", "b"] })
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.question, "")
    assert.deepEqual(groups[0]!.options, ["a", "b"])
  })
})

describe("parseQuestionArgs — nested questions[] shape", () => {
  it("parses multiple question groups with headers and object options", () => {
    const groups = parseQuestionArgs({
      questions: [
        {
          question: "Which DB?",
          header: "Database",
          options: [{ label: "Postgres", description: "relational" }, { label: "Mongo" }],
        },
        {
          question: "Which features?",
          header: "Features",
          options: ["Auth", "Billing"],
          multiSelect: true,
        },
      ],
    })
    assert.equal(groups.length, 2)
    assert.equal(groups[0]!.header, "Database")
    assert.deepEqual(groups[0]!.options, ["Postgres", "Mongo"])
    assert.equal(groups[0]!.multiSelect, false)
    assert.equal(groups[1]!.header, "Features")
    assert.deepEqual(groups[1]!.options, ["Auth", "Billing"])
    assert.equal(groups[1]!.multiSelect, true)
  })

  it("drops empty entries inside questions[]", () => {
    const groups = parseQuestionArgs({ questions: [{}, { question: "real?" }, null] })
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.question, "real?")
  })

  it("falls back to flat when questions[] yields nothing usable", () => {
    const groups = parseQuestionArgs({ questions: [{}], question: "fallback?" })
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.question, "fallback?")
  })
})

describe("parseQuestionArgs — empty/partial input", () => {
  it("returns [] for undefined/null/empty/non-object", () => {
    assert.deepEqual(parseQuestionArgs(undefined), [])
    assert.deepEqual(parseQuestionArgs(null), [])
    assert.deepEqual(parseQuestionArgs({}), [])
    assert.deepEqual(parseQuestionArgs("not an object"), [])
    assert.deepEqual(parseQuestionArgs({ questions: [] }), [])
  })
})

describe("toOptionLabels", () => {
  it("maps strings, {label}, and {value}; drops empties", () => {
    assert.deepEqual(
      toOptionLabels(["a", { label: "b" }, { value: "c" }, { label: "" }, ""]),
      ["a", "b", "c"]
    )
  })
  it("returns [] for non-arrays", () => {
    assert.deepEqual(toOptionLabels(undefined), [])
    assert.deepEqual(toOptionLabels({}), [])
  })
})

describe("parseAllowFreeText", () => {
  it("defaults to true and only false disables it", () => {
    assert.equal(parseAllowFreeText({}), true)
    assert.equal(parseAllowFreeText({ allowFreeText: true }), true)
    assert.equal(parseAllowFreeText({ allowFreeText: false }), false)
    assert.equal(parseAllowFreeText(undefined), true)
  })
})
