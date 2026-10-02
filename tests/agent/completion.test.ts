import { describe, expect, it } from 'vitest';
import { classifyCompletion, classifyConfirmation } from '../../services/agent/src/session/completion';

describe('classifyCompletion', () => {
  it.each([
    "That's all.",
    "I'm done.",
    "That's everything.",
    'Thank you, goodbye.',
    "I don't need anything else.",
    "No, that's all, thanks",
    'okay thanks bye',
    'Nothing else for now, thank you',
    'goodbye',
    'thats it',
    "that'll be all",
    'that will be all',
    "that'll be everything",
    "that's all, have a great day",
    "that'll be all, good bye",
    'good bye',
    'have a great day',
    'Never mind. I think we are done here',
    "I think we're done",
    'we are done here',
    "actually that's all",
    "I'm all set here",
  ])('treats "%s" as a clear closer', (text) => {
    expect(classifyCompletion(text)).toBe('clear');
  });

  it.each(['Never mind', 'nevermind.', 'Okay, never mind', 'forget it'])(
    'treats "%s" as ambiguous (a withdrawn question, confirm first)',
    (text) => {
      expect(classifyCompletion(text)).toBe('ambiguous');
    },
  );

  it.each(['Okay, thanks.', 'thank you', 'Great, thanks a lot', 'perfect thanks', "that's helpful thanks"])(
    'treats "%s" as ambiguous (confirm first)',
    (text) => {
      expect(classifyCompletion(text)).toBe('ambiguous');
    },
  );

  it.each([
    'What is the status of TXN-9001?',
    "That's all I know about my payout, can you check?",
    "That's all well and good but my payout is still missing from last week",
    "That's all?",
    'I need to send 500 dollars',
    'Never mind, what about my payout',
    "I'm done with the form but where is TXN-9001",
    "we're not done, my payout is still missing",
    'okay',
    'yes',
    'no',
    'thanks for checking but I still have a problem with my invoice payment failing',
    '',
    '   ',
  ])('leaves "%s" to the agent', (text) => {
    expect(classifyCompletion(text)).toBe('none');
  });
});

describe('classifyConfirmation (reply to "anything else?")', () => {
  it.each(['No', 'nope', 'No thanks', "No, that's all", 'nothing', "I'm good", 'thanks', 'all good thank you'])(
    'ends on "%s"',
    (text) => {
      expect(classifyConfirmation(text)).toBe('end');
    },
  );

  it.each([
    'Actually yes, what about TXN-9001',
    'yes',
    'No, I meant the other payout',
    'Can you also check my invoice?',
    'No what about my payout?',
  ])('continues on "%s"', (text) => {
    expect(classifyConfirmation(text)).toBe('continue');
  });
});
