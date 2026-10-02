/**
 * Strings for the signed-in area. `SHELL_COPY` is customer-facing and follows the same vocabulary rule as `COPY`
 * (no internal or technical terms; tests/web/shell-copy.test.ts checks it). `STAFF_COPY` is for RelayPay's own staff
 * and may use staff vocabulary, which is why it is kept apart.
 */
export const SHELL_COPY = {
  brand: 'RelayPay',
  signIn: {
    title: 'Sign in to RelayPay',
    intro: 'Use your RelayPay account to see your payments and get help.',
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    invalid: 'That email address or password is not right. Please check them and try again.',
    tooMany: 'Too many attempts. Please wait a few minutes and try again.',
    unavailable: 'We could not sign you in just now. Please try again in a moment.',
    emailRequired: 'Enter your email address.',
    passwordRequired: 'Enter your password.',
  },
  nav: {
    label: 'Main',
    dashboard: 'Overview',
    payments: 'Payments',
    payouts: 'Payouts',
    invoices: 'Invoices',
    support: 'Support',
    settings: 'Settings',
    signOut: 'Sign out',
    skip: 'Skip to main content',
  },
  overview: {
    title: 'Overview',
    paymentsCard: 'Payments',
    payoutsCard: 'Payouts',
    invoicesCard: 'Invoices',
    recent: 'Recent activity',
    recentEmpty: 'No activity yet.',
    support: 'Need help?',
    supportBody: 'Talk to RelayPay Support about a payment, a payout or your account.',
    supportAction: 'Start a conversation',
    conversations: 'Your recent conversations',
    conversationsEmpty: 'You have not talked to RelayPay Support yet.',
    viewAll: 'View all',
  },
  lists: {
    payments: { title: 'Payments', empty: 'No payments yet.' },
    payouts: { title: 'Payouts', empty: 'No payouts yet.' },
    invoices: { title: 'Invoices', empty: 'No invoices yet.' },
    columns: {
      reference: 'Reference',
      date: 'Date',
      amount: 'Amount',
      status: 'Status',
      type: 'Type',
      recipient: 'Recipient',
    },
  },
  support: {
    title: 'RelayPay Support',
    transcriptTitle: 'Conversation',
    transcriptEmpty: 'Nothing was said in this conversation.',
    back: 'Back to overview',
    you: 'You',
    support: 'RelayPay Support',
    ticket: 'Reference',
  },
  settings: {
    title: 'Settings',
    profile: 'Your details',
    name: 'Name',
    email: 'Email address',
    company: 'Company',
    plan: 'Plan',
    signOutHint: 'Signing out ends your session on this device.',
  },
  notFound: {
    title: 'We could not find that',
    body: 'It may not exist, or it may belong to a different account.',
    action: 'Back to overview',
  },
} as const;

export const STAFF_COPY = {
  brand: 'RelayPay Support Desk',
  nav: {
    label: 'Staff',
    queue: 'Queue',
    conversations: 'Conversations',
    signOut: 'Sign out',
    skip: 'Skip to main content',
  },
  queue: {
    title: 'Support queue',
    open: 'Open',
    waiting: 'Waiting for staff',
    escalated: 'Escalated',
    resolvedToday: 'Resolved today',
    empty: 'No conversations to show.',
    columns: { customer: 'Customer', issue: 'Issue', status: 'Status', started: 'Started', ticket: 'Ticket' },
  },
  conversations: { title: 'Conversations', empty: 'No conversations yet.' },
  detail: {
    title: 'Conversation',
    transcript: 'Transcript',
    transcriptEmpty: 'No turns recorded.',
    customer: 'Customer',
    ticket: 'Ticket',
    escalation: 'Escalation',
    callback: 'Callback request',
    unlinked: 'Not linked to a customer account',
    back: 'Back to conversations',
    notFound: 'Conversation not found, or not available to you.',
  },
} as const;

/** Every string of an object tree, for the vocabulary test. */
export function allStrings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree];
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(allStrings);
  return [];
}
