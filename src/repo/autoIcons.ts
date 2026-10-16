import { LOGO_LIST, LOGO_PREFIX } from '../components/logoList.ts'

/**
 * Icon suggestions from note/folder titles: a tool's colorful logo if its name appears (`LOGO_LIST`
 * keywords), else keyword rules for DevOps and general dev topics. Rule icons are Lucide names
 * (validated against the Lucide list in the unit test). First matching rule wins, so specific tools
 * come before generic words.
 */
const RULES: [icon: string, keywords: string[]][] = [
  // Containers & orchestration
  [
    'ship-wheel',
    ['kubernetes', 'k8s', 'k3s', 'helm', 'kubectl', 'eks', 'aks', 'gke', 'openshift', 'kustomize', 'pod'],
  ],
  ['container', ['docker', 'dockerfile', 'container', 'podman', 'compose', 'containerd', 'ecs', 'fargate']],
  // Infrastructure as code & config management
  ['layers', ['terraform', 'opentofu', 'pulumi', 'cloudformation', 'cdk', 'iac', 'infrastructure as code']],
  ['wrench', ['ansible', 'chef', 'puppet', 'saltstack', 'salt', 'packer']],
  // CI/CD & source control
  [
    'workflow',
    [
      'ci',
      'cd',
      'cicd',
      'pipeline',
      'jenkins',
      'github actions',
      'gitlab ci',
      'argo',
      'argocd',
      'flux',
      'tekton',
      'circleci',
      'build',
    ],
  ],
  ['rocket', ['deploy', 'deployment', 'release', 'rollout', 'launch', 'blue green', 'canary']],
  [
    'git-branch',
    ['git', 'github', 'gitlab', 'bitbucket', 'branch', 'branching', 'merge', 'rebase', 'version control'],
  ],
  // Cloud
  [
    'cloud',
    [
      'aws',
      'azure',
      'gcp',
      'google cloud',
      'cloud',
      'lambda',
      'serverless',
      'cloudflare',
      'digitalocean',
      'hetzner',
    ],
  ],
  // Security
  ['key-round', ['ssh', 'secret', 'vault', 'password', 'credential', 'key', 'token', 'gpg']],
  ['lock', ['tls', 'ssl', 'certificate', 'cert', 'https', 'vpn', 'wireguard', 'encryption']],
  [
    'shield',
    [
      'security',
      'firewall',
      'iam',
      'rbac',
      'auth',
      'authentication',
      'authorization',
      'permission',
      'policy',
      'compliance',
      'sso',
      'oauth',
    ],
  ],
  // Networking
  [
    'network',
    [
      'network',
      'networking',
      'dns',
      'vpc',
      'subnet',
      'load balancer',
      'ingress',
      'proxy',
      'nginx',
      'haproxy',
      'traefik',
      'envoy',
      'istio',
      'service mesh',
      'cdn',
      'tcp',
      'http',
      'ip',
    ],
  ],
  // Observability & operations
  [
    'activity',
    [
      'monitoring',
      'prometheus',
      'grafana',
      'metric',
      'observability',
      'datadog',
      'new relic',
      'uptime',
      'health check',
      'tracing',
      'opentelemetry',
      'jaeger',
    ],
  ],
  ['bell', ['alert', 'alerting', 'alertmanager', 'pagerduty', 'notification']],
  [
    'scroll-text',
    ['log', 'logging', 'elk', 'elasticsearch', 'kibana', 'loki', 'fluentd', 'fluent bit', 'splunk', 'syslog'],
  ],
  ['siren', ['incident', 'outage', 'postmortem', 'post mortem', 'on call', 'oncall', 'sre', 'runbook']],
  ['bug', ['debug', 'debugging', 'troubleshoot', 'troubleshooting', 'bug', 'error', 'fix']],
  ['gauge', ['performance', 'scaling', 'autoscaling', 'load test', 'benchmark', 'latency', 'capacity']],
  // Data & storage
  [
    'database',
    [
      'database',
      'db',
      'postgres',
      'postgresql',
      'mysql',
      'mariadb',
      'redis',
      'mongo',
      'mongodb',
      'sql',
      'dynamodb',
      'cassandra',
      'sqlite',
    ],
  ],
  ['archive', ['backup', 'restore', 'snapshot', 'disaster recovery', 'dr']],
  ['hard-drive', ['storage', 'disk', 'volume', 's3', 'nfs', 'ebs', 'filesystem', 'raid', 'ceph']],
  ['messages-square', ['kafka', 'rabbitmq', 'queue', 'sqs', 'sns', 'pubsub', 'nats', 'messaging', 'event']],
  // Systems
  [
    'terminal',
    [
      'linux',
      'bash',
      'shell',
      'terminal',
      'cli',
      'zsh',
      'command',
      'tmux',
      'vim',
      'neovim',
      'nvim',
      'ubuntu',
      'debian',
      'arch',
      'systemd',
      'unix',
    ],
  ],
  [
    'server',
    ['server', 'vm', 'virtual machine', 'ec2', 'host', 'bare metal', 'proxmox', 'homelab', 'cluster', 'node'],
  ],
  ['clock', ['cron', 'schedule', 'scheduler', 'job', 'timer']],
  ['settings', ['config', 'configuration', 'setup', 'settings', 'yaml', 'env', 'environment', 'dotfiles']],
  // Code
  [
    'code',
    [
      'python',
      'go',
      'golang',
      'rust',
      'java',
      'javascript',
      'typescript',
      'node',
      'nodejs',
      'ruby',
      'script',
      'scripting',
      'code',
      'programming',
    ],
  ],
  ['braces', ['api', 'rest', 'graphql', 'grpc', 'json', 'webhook']],
  ['blocks', ['architecture', 'design', 'microservice', 'system design', 'diagram']],
  // Notes & planning
  ['dollar-sign', ['cost', 'billing', 'finops', 'pricing', 'budget']],
  ['list-checks', ['todo', 'task', 'checklist', 'roadmap', 'plan', 'backlog']],
  ['clipboard-list', ['cheatsheet', 'cheat sheet', 'cheat', 'reference', 'commands']],
  [
    'book-open',
    [
      'docs',
      'documentation',
      'readme',
      'guide',
      'tutorial',
      'learning',
      'course',
      'book',
      'wiki',
      'how to',
      'howto',
    ],
  ],
  ['message-circle-question', ['interview', 'question', 'faq', 'qa']],
  ['lightbulb', ['idea', 'tip', 'trick', 'best practice']],
]

/** "GitHub Actions – CI/CD.md" → " github actions ci cd " (tokens separated by single spaces). */
function normalize(title: string): string {
  return ` ${title
    .toLowerCase()
    .replace(/\.md$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ')} `
}

const has = (norm: string, kw: string) =>
  norm.includes(` ${kw} `) || norm.includes(` ${kw}s `) || norm.includes(` ${kw}es `)

/** Icon (`logo:<id>` or a Lucide name) for a note/folder title, or undefined if nothing fits. */
export function suggestIcon(title: string): string | undefined {
  const norm = normalize(title)
  for (const logo of LOGO_LIST) if (logo.keywords.some((k) => has(norm, k))) return LOGO_PREFIX + logo.id
  for (const [icon, keywords] of RULES) if (keywords.some((k) => has(norm, k))) return icon
  return undefined
}

/** All icon names used by the rules (for validation). */
export const RULE_ICONS = [...new Set(RULES.map(([icon]) => icon))]
