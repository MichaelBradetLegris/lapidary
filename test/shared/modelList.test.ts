import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { CHATGPT_EMPTY_MODEL_LIST, CHATGPT_REVIEW_FAILURES } from '../../src/shared/ui/chatgpt';
import { LIST_MODELS_AGAIN, NO_MODEL_BLOCKER, modelListFailedText } from '../../src/shared/ui/models';

/* The codex.3 review: Review with AI's words for a model list that could not
   be fetched, or came back empty. The dialog that shows them is in
   test/renderer/chatgptReview.render.test.ts, and how the page asks for the
   list again in test/renderer/chatgptWiring.test.ts. */

describe("Review with AI's words for a model list that failed", () => {
  it("says whose list could not be listed, then main's words for why", () => {
    expect(modelListFailedText('chatgpt', CHATGPT_REVIEW_FAILURES.modelsNoAnswer)).toBe(
      'The models on your ChatGPT plan could not be listed. Could not reach OpenAI to list the models of your ChatGPT plan. Check your connection and try again.'
    );
    expect(modelListFailedText('openai', 'OpenAI rejected the API key.')).toBe(
      'The models for your OpenAI key could not be listed. OpenAI rejected the API key.'
    );
    expect(modelListFailedText('claude', 'Claude Code did not answer.')).toBe(
      "Claude Code's models could not be listed. Claude Code did not answer."
    );
  });

  it('says only what failed when main gave no words', () => {
    expect(modelListFailedText('chatgpt', '  ')).toBe('The models on your ChatGPT plan could not be listed.');
  });

  it('has Try again, and a line beside Start that says what it waits for', () => {
    expect(LIST_MODELS_AGAIN).toBe('Try again');
    expect(NO_MODEL_BLOCKER).toBe('The review cannot start until a model is listed.');
  });

  it('says an empty ChatGPT list in the words a review without a model fails with (5.8 item 2)', () => {
    expect(CHATGPT_EMPTY_MODEL_LIST).toBe(`Your ChatGPT sign-in lists no model ${APP_NAME} can review with.`);
    expect(CHATGPT_REVIEW_FAILURES.noModels).toBe(
      `${CHATGPT_EMPTY_MODEL_LIST.slice(0, -1)}, so the review did not run.`
    );
  });

  it('words a sign-in OpenAI refused after its renewal so it reads right for a review and for the list', () => {
    expect(CHATGPT_REVIEW_FAILURES.signInNotAccepted).not.toMatch(/review/);
  });
});
