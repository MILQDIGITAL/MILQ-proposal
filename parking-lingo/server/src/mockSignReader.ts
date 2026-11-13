import { fixtures, fixturesById, type SignFixture } from "@parking-lingo/core/fixtures";
import { SignReaderError, type ReadSignInput, type ReadSignResult, type SignReader } from "./signReader";

/**
 * MOCK_VISION=1: returns fixtures from @parking-lingo/core/fixtures instead of calling Claude.
 * Pick one with the `x-mock-fixture: <id>` header; otherwise they cycle in order.
 */
export class MockSignReader implements SignReader {
  private next = 0;

  constructor(private readonly list: readonly SignFixture[] = fixtures) {}

  async read(input: ReadSignInput): Promise<ReadSignResult> {
    let fixture: SignFixture | undefined;
    if (input.mockFixtureId) {
      fixture = fixturesById[input.mockFixtureId];
      if (!fixture) {
        throw new SignReaderError(
          "unknown_fixture",
          `Unknown mock fixture "${input.mockFixtureId}". Known: ${this.list.map((f) => f.id).join(", ")}`,
        );
      }
    } else {
      fixture = this.list[this.next % this.list.length]!;
      this.next++;
    }
    return {
      // Deep copy so callers can't mutate the shared fixture.
      reading: structuredClone(fixture.reading),
      model: "mock",
      attempts: 1,
      mock: {
        fixtureId: fixture.id,
        title: fixture.title,
        demoNow: String(fixture.demoContext.now),
        demoContext: structuredClone(fixture.demoContext),
      },
    };
  }
}

export function listMockFixtures(): { id: string; title: string; description: string }[] {
  return fixtures.map((f) => ({ id: f.id, title: f.title, description: f.description }));
}
