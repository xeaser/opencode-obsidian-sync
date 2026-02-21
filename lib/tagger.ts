import type { ReconstructedConversation } from "./types";

const MAX_TAGS = 15;

interface TagRule {
  pattern: RegExp;
  tag: string;
}

const TOPIC_RULES: TagRule[] = [
  { pattern: /\b(authenticat|auth[- ]?flow|login|signup|sign[- ]?up|oauth|jwt|bearer\s+token)\b/i, tag: "topic/authentication" },
  { pattern: /\b(database|sql\b|query|migration|schema|postgres|mysql|mongo|sqlite|table\b|column\b)\b/i, tag: "topic/database" },
  { pattern: /\b(test(s|ing)?|jest|vitest|pytest|\.spec\.|\.test\.|assert|expect\(|describe\(|it\()\b/i, tag: "topic/testing" },
  { pattern: /\b(deploy(ment|ing)?|ci[\/-]cd|pipeline|github[- ]?actions|workflow|\.ya?ml\b)/i, tag: "topic/ci-cd" },
  { pattern: /\b(refactor(ing|ed)?|rename|extract\s+(method|function|class)|cleanup|restructur)/i, tag: "topic/refactoring" },
  { pattern: /\b(debug(g(er|ing))?|breakpoint|stack\s*trace|error|fix(ed|ing)?|bug(s|fix)?)\b/i, tag: "topic/debugging" },
  { pattern: /\b(api\b|endpoint|route(s|r)?|rest\b|graphql|grpc|http(s)?\b)/i, tag: "topic/api" },
  { pattern: /\b(performance|optimiz(e|ation)|cache|latenc|profil(e|ing)|benchmark)/i, tag: "topic/performance" },
  { pattern: /\b(security|vulnerabilit|xss|csrf|injection|sanitiz|encrypt|decrypt)/i, tag: "topic/security" },
  { pattern: /\b(ui\b|frontend|css\b|style(s|d|sheet)?|component(s)?|layout|responsive)\b/i, tag: "topic/ui" },
  { pattern: /\b(config(uration)?|setup|install(ation)?|init(ializ)?|scaffold|boilerplate)\b/i, tag: "topic/setup" },
  { pattern: /\b(docker|container(s|iz)?|kubernetes|k8s|helm)\b/i, tag: "topic/infrastructure" },
];

const TECH_RULES: TagRule[] = [
  { pattern: /\b(typescript|\.tsx?\b)/i, tag: "tech/typescript" },
  { pattern: /\b(javascript|\.jsx?\b)/i, tag: "tech/javascript" },
  { pattern: /\b(python|\.py\b|pip\b|pytest)\b/i, tag: "tech/python" },
  { pattern: /\b(react|jsx|use[A-Z]\w+\(|useState|useEffect)\b/, tag: "tech/react" },
  { pattern: /\b(next\.?js|next\.config|next[/-]app)\b/i, tag: "tech/nextjs" },
  { pattern: /\b(vue|\.vue\b|vuex|pinia)\b/i, tag: "tech/vue" },
  { pattern: /\b(node\.?js|nodejs|npm\b|yarn\b|pnpm\b)\b/i, tag: "tech/nodejs" },
  { pattern: /\b(bun\b|bunx|bun\.sh)\b/i, tag: "tech/bun" },
  { pattern: /\b(postgres(ql)?|pg_|psql)\b/i, tag: "tech/postgres" },
  { pattern: /\b(redis|ioredis)\b/i, tag: "tech/redis" },
  { pattern: /\b(docker(file)?|docker[- ]?compose)\b/i, tag: "tech/docker" },
  { pattern: /\b(aws|s3\b|lambda\b|ec2\b|dynamodb|cloudfront)\b/i, tag: "tech/aws" },
  { pattern: /\b(graphql|gql\b|apollo|urql)\b/i, tag: "tech/graphql" },
  { pattern: /\b(git(hub|lab|bucket)?\b)/i, tag: "tech/git" },
  { pattern: /\b(obsidian|dataview|wikilink)\b/i, tag: "tech/obsidian" },
  { pattern: /\b(tailwind(css)?)\b/i, tag: "tech/tailwind" },
  { pattern: /\b(prisma|drizzle|typeorm|sequelize)\b/i, tag: "tech/orm" },
  { pattern: /\b(openai|anthropic|claude|gpt[- ]?\d|llm|embeddings)\b/i, tag: "tech/ai" },
];

const ACTIVITY_RULES: TagRule[] = [
  { pattern: /\b(fix(ed|ing|es)?|bug(s|fix)?|issue|patch|hotfix|broken)\b/i, tag: "activity/bugfix" },
  { pattern: /\b(feature|implement(ed|ing)?|add(ed|ing)?|creat(e|ed|ing)|build(ing)?|new\s+(component|function|module|file|endpoint))\b/i, tag: "activity/feature" },
  { pattern: /\b(explor(e|ing|ation)|investigat(e|ing)|research|look\s+into|understand|how\s+does)\b/i, tag: "activity/exploration" },
  { pattern: /\b(review|feedback|pr\b|pull\s+request|code\s+review)\b/i, tag: "activity/review" },
  { pattern: /\b(setup|install|configur(e|ing|ation)|init(ializ)?\b|scaffold)\b/i, tag: "activity/setup" },
  { pattern: /\b(migrat(e|ion|ing)|upgrade|update\s+version)\b/i, tag: "activity/migration" },
];

const DOMAIN_PATTERNS: [RegExp, string][] = [
  [/\b(opencode|oh-my-opencode|ohmyopencode|opencode-ai|opencode\.ai)\b/i, "domain/opencode"],
  [/\b(bifrost)\b/i, "domain/bifrost"],
  [/\b(aifr|aifr-core|aifr-preprod)\b/i, "domain/aifr"],
  [/\b(obsidian|dataview|wikilink|vault)\b/i, "domain/obsidian"],
  [/\b(neovim|nvim|lazyvim|vim)\b/i, "domain/neovim"],
  [/\b(kubernetes|k8s|kind-cluster|helm|kubectl)\b/i, "domain/kubernetes"],
  [/\b(tailscale|homelab|glance)\b/i, "domain/homelab"],
  [/\b(aws|amazon|cloudfront|s3|lambda|ec2|bedrock|dynamodb|sagemaker)\b/i, "domain/aws"],
  [/\b(docker|dockerfile|docker-compose|container)\b/i, "domain/docker"],
  [/\b(github|github-actions|gh-cli)\b/i, "domain/github"],
  [/\b(terraform|pulumi|cloudformation)\b/i, "domain/iac"],
  [/\b(postgres|postgresql|mysql|mongodb|sqlite|database|sql)\b/i, "domain/database"],
  [/\b(react|nextjs|next\.js|remix|gatsby)\b/i, "domain/react"],
  [/\b(python|django|flask|fastapi)\b/i, "domain/python"],
  [/\b(typescript|javascript|nodejs|node\.js|bun|deno)\b/i, "domain/javascript"],
];

function buildSearchText(conv: ReconstructedConversation): string {
  const parts: string[] = [];

  for (const entry of conv.entries) {
    if (entry.textContent) {
      parts.push(entry.textContent);
    }
    for (const tc of entry.toolCalls) {
      parts.push(tc.tool);
      if (tc.input) {
        const inputStr = JSON.stringify(tc.input);
        parts.push(inputStr);
      }
      if (tc.output) {
        const truncated = tc.output.length > 500 ? tc.output.slice(0, 500) : tc.output;
        parts.push(truncated);
      }
    }
  }

  return parts.join("\n").toLowerCase();
}

function matchRules(text: string, rules: TagRule[]): Array<{ tag: string; count: number }> {
  const results: Array<{ tag: string; count: number }> = [];
  for (const rule of rules) {
    const matches = text.match(new RegExp(rule.pattern.source, rule.pattern.flags + "g"));
    if (matches && matches.length > 0) {
      results.push({ tag: rule.tag, count: matches.length });
    }
  }
  results.sort((a, b) => b.count - a.count);
  return results;
}

const DOMAIN_TEXT_THRESHOLD = 3;

function matchDomainTags(text: string, title: string, tags: Set<string>): void {
  for (const [pattern, tag] of DOMAIN_PATTERNS) {
    if (pattern.test(title)) {
      tags.add(tag);
      continue;
    }
    const matches = text.match(new RegExp(pattern.source, pattern.flags + "g"));
    if (matches && matches.length >= DOMAIN_TEXT_THRESHOLD) {
      tags.add(tag);
    }
  }
}

export function extractTags(conv: ReconstructedConversation): string[] {
  const tags: string[] = [];

  if (conv.projectName) {
    tags.push(`project/${conv.projectName.toLowerCase()}`);
  }

  const text = buildSearchText(conv);
  if (!text) {
    return tags;
  }

  const topicMatches = matchRules(text, TOPIC_RULES);
  const techMatches = matchRules(text, TECH_RULES);
  const activityMatches = matchRules(text, ACTIVITY_RULES);

  for (const m of topicMatches) {
    if (tags.length >= MAX_TAGS) break;
    tags.push(m.tag);
  }
  for (const m of techMatches) {
    if (tags.length >= MAX_TAGS) break;
    tags.push(m.tag);
  }
  for (const m of activityMatches) {
    if (tags.length >= MAX_TAGS) break;
    tags.push(m.tag);
  }

  const title = conv.session.title || conv.session.slug || "";
  const domainSet = new Set<string>();
  matchDomainTags(text, title, domainSet);
  for (const dt of domainSet) {
    if (tags.length >= MAX_TAGS) break;
    if (!tags.includes(dt)) tags.push(dt);
  }

  return tags;
}
