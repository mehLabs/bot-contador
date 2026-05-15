import { LinearClient, type Issue, type User } from '@linear/sdk';
import { QUOTES } from './quotes.js';

export type LinearNotificationUser = {
  id: string;
  name: string;
};

export type LinearNotificationIssue = {
  assigneeId?: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  stateName: string;
  stateType: string;
};

export type LinearNotificationSnapshot = {
  users: LinearNotificationUser[];
  issues: LinearNotificationIssue[];
};

const CLOSED_STATE_TYPES = new Set(['completed', 'canceled', 'duplicate']);

export class LinearNotificationService {
  constructor(private readonly client: LinearClient) {}

  async pendingSnapshot(): Promise<LinearNotificationSnapshot> {
    const [users, issues] = await Promise.all([this.activeUsers(), this.openAssignedIssues()]);
    return { users, issues };
  }

  private async activeUsers(): Promise<LinearNotificationUser[]> {
    const users = await fetchAllPages((variables) =>
      this.client.users({
        ...variables,
        first: 100,
        filter: { active: { eq: true }, app: { eq: false } }
      })
    );
    return users
      .map((user) => ({ id: user.id, name: formatLinearUserName(user) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  private async openAssignedIssues(): Promise<LinearNotificationIssue[]> {
    const issues = await fetchAllPages((variables) =>
      this.client.issues({
        ...variables,
        first: 100,
        filter: {
          assignee: { null: false },
          state: { type: { nin: ['completed', 'canceled', 'duplicate'] } }
        }
      })
    );
    return Promise.all(issues.map((issue) => issueToNotificationIssue(issue)));
  }
}

export function formatLinearDailyMessage(snapshot: LinearNotificationSnapshot, quote = randomQuote()): string {
  const activeUserIds = new Set(snapshot.users.map((user) => user.id));
  const issuesByUser = new Map<string, LinearNotificationIssue[]>();
  for (const issue of snapshot.issues) {
    if (!issue.assigneeId || !activeUserIds.has(issue.assigneeId) || isClosedState(issue.stateType)) continue;
    const existing = issuesByUser.get(issue.assigneeId) ?? [];
    existing.push(issue);
    issuesByUser.set(issue.assigneeId, existing);
  }

  const lines = ['Buen dia!', 'Estos son los issues pendientes al dia de hoy:', ''];
  for (const user of snapshot.users) {
    lines.push(user.name);
    const issues = (issuesByUser.get(user.id) ?? []).sort(compareIssues);
    if (issues.length === 0) {
      lines.push('- Sin issues pendientes');
    } else {
      for (const issue of issues) {
        lines.push(`- ${issue.identifier} ${issue.title} [${formatIssueMeta(issue)}]`);
      }
    }
    lines.push('');
  }
  lines.push(`> ${quote}`);
  return lines.join('\n');
}

export function compareIssues(a: LinearNotificationIssue, b: LinearNotificationIssue): number {
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff !== 0) return priorityDiff;
  return a.identifier.localeCompare(b.identifier, 'es', { numeric: true });
}

export function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority;
}

export function formatIssueMeta(issue: Pick<LinearNotificationIssue, 'priority' | 'priorityLabel' | 'stateName'>): string {
  if (issue.priority === 0 || issue.priorityLabel.toLowerCase() === 'no priority') return issue.stateName;
  return `${issue.priorityLabel} | ${issue.stateName}`;
}

export function formatLinearUserName(user: Pick<User, 'id'> & Partial<Pick<User, 'displayName' | 'email' | 'name'>>): string {
  const email = user.email?.trim();
  const fullName = user.name?.trim();
  if (fullName && !sameAsEmailLocalPart(fullName, email)) return fullName;

  const username = user.displayName?.trim() || fullName;
  if (username && sameAsEmailLocalPart(username, email)) return email!;
  return username || email || user.id;
}

export function isClosedState(stateType: string): boolean {
  return CLOSED_STATE_TYPES.has(stateType);
}

export function randomQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)] ?? QUOTES[0];
}

async function issueToNotificationIssue(issue: Issue): Promise<LinearNotificationIssue> {
  const state = await issue.state;
  return {
    assigneeId: issue.assigneeId,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    stateName: state?.name ?? 'Sin estado',
    stateType: state?.type ?? 'unknown'
  };
}

async function fetchAllPages<T extends { pageInfo: { endCursor?: string | null; hasNextPage: boolean }; nodes: unknown[] }>(
  fetchPage: (variables?: { after?: string | null }) => Promise<T>
): Promise<T['nodes']> {
  let connection = await fetchPage();
  const nodes = [...connection.nodes] as T['nodes'];
  while (connection.pageInfo.hasNextPage) {
    connection = await fetchPage({ after: connection.pageInfo.endCursor ?? null });
    nodes.push(...(connection.nodes as T['nodes']));
  }
  return nodes;
}

function sameAsEmailLocalPart(value: string, email?: string): boolean {
  if (!email) return false;
  const localPart = email.split('@')[0];
  return value.toLowerCase() === localPart.toLowerCase();
}
