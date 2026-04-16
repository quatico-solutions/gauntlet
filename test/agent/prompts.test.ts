import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/prompts";
import type { StoryCard } from "../../src/format/story-card";

describe("buildSystemPrompt", () => {
  test("includes story card content", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "User can add a todo",
      status: "ready",
      tags: ["core"],
      description: "As a user I want to add a todo",
      acceptanceCriteria: ["Item appears in list", "Count updates"],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("story-001");
    expect(prompt).toContain("User can add a todo");
    expect(prompt).toContain("Item appears in list");
    expect(prompt).toContain("Count updates");
  });

  test("instructs agent to report observations", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Test story",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("observation");
  });

  test("instructs autonomous exploration when no criteria", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Explore the app",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("explore");
  });

  // Context section — Gauntlet v1.5 spec §4.1. The three-paragraph
  // prose is load-bearing; these assertions are fixed strings so any
  // drift breaks at CI time and the author has to either change the
  // spec (via amendment) or revert.
  describe("Context section (spec §4.1)", () => {
    const baseCard: StoryCard = {
      id: "story-001",
      title: "A test story",
      status: "ready",
      tags: [],
      description: "Do the thing.",
      acceptanceCriteria: [],
      raw: "",
    };

    // Authoritative prose, copy-pasted from spec §4.1, with
    // {{TREE_LISTING}} already substituted for the sample tree used
    // below. If the spec prose is amended, update this fixture AND
    // the spec in the same commit.
    const SAMPLE_TREE = "  alice.md  (5 bytes)";
    const EXPECTED_CONTEXT_SECTION =
      "## Context\n\n" +
      "The project has a context directory at `.gauntlet/context/`. This is a\n" +
      "freeform data store the story author set up for this project. Read files\n" +
      "with `read` and pull out whatever you need to carry out the story.\n\n" +
      "Stories will often refer to users by name (\"Alice\", \"as bob\") without\n" +
      "spelling out credentials. When that happens, look for a matching path in\n" +
      "the tree below, `read` the relevant files, and use what you find to log\n" +
      "in via the regular browser tools. A profile directory typically contains\n" +
      "an identity file (prose describing the person) and a credentials file;\n" +
      "some also contain `passkey.json` for WebAuthn sign-in via\n" +
      "`install_passkey`.\n\n" +
      "Below is the complete tree of everything available under\n" +
      "`.gauntlet/context/` for this run. File sizes in bytes are shown after\n" +
      "each entry. This listing is the full map: it is built once at the start\n" +
      "of the run and does not change while the run is in flight, so you do not\n" +
      "need to — and cannot — re-list the directory. Every file you might need\n" +
      "is in this tree; if a path is not shown here, it does not exist.\n\n" +
      "### .gauntlet/context/\n" +
      SAMPLE_TREE;

    test("section is appended verbatim when a tree is provided", () => {
      const prompt = buildSystemPrompt(baseCard, SAMPLE_TREE);
      expect(prompt).toContain(EXPECTED_CONTEXT_SECTION);
    });

    test("section is the last block in the prompt", () => {
      const prompt = buildSystemPrompt(baseCard, SAMPLE_TREE);
      expect(prompt.endsWith(EXPECTED_CONTEXT_SECTION)).toBe(true);
    });

    test("section is omitted when contextTree is undefined", () => {
      const prompt = buildSystemPrompt(baseCard);
      expect(prompt).not.toContain("## Context");
      expect(prompt).not.toContain(".gauntlet/context/");
    });

    test("section is omitted when contextTree is the empty string", () => {
      const prompt = buildSystemPrompt(baseCard, "");
      expect(prompt).not.toContain("## Context");
      expect(prompt).not.toContain(".gauntlet/context/");
    });

    test("immutability-invariant prose is present", () => {
      const prompt = buildSystemPrompt(baseCard, SAMPLE_TREE);
      // This is the prose face of spec §4.2 — it must not drift.
      expect(prompt).toContain(
        "built once at the start\nof the run and does not change while the run is in flight",
      );
      expect(prompt).toContain("you do not\nneed to — and cannot — re-list the directory");
    });
  });
});
