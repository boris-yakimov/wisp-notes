/**
 * Colorful brand logos offered as icons, from the `devicon` npm package (MIT). Only these files are
 * bundled (see `logosPlugin` in vite.config.ts); they are stored in `_meta.json` as `logo:<id>`.
 * Pure data, also imported by vite.config.ts.
 *
 * `keywords` are whole words that make Auto-assign pick the logo (first match in this order wins, so
 * specific tools come first); they are searchable too. `dark`: a dark logo, inverted in dark themes.
 */
/** Prefix of logo icons in `_meta.json` (`logo:kubernetes`), so they never clash with Lucide names. */
export const LOGO_PREFIX = 'logo:'

export interface LogoDef {
  id: string
  /** Path under `devicon/icons/`. */
  file: string
  label: string
  keywords: string[]
  dark?: boolean
}

const d = (id: string, file: string, label: string, keywords: string[] = [], dark = false): LogoDef => ({
  id,
  file,
  label,
  keywords,
  ...(dark ? { dark } : {}),
})

export const LOGO_LIST: LogoDef[] = [
  // Cloud
  d('aws', 'amazonwebservices/amazonwebservices-plain-wordmark.svg', 'AWS', [
    'aws',
    'amazon web services',
    'ec2',
    's3',
    'cloudwatch',
    'route53',
    'ecs',
    'fargate',
    'cloudformation',
  ]),
  d('gcp', 'googlecloud/googlecloud-original.svg', 'Google Cloud', [
    'gcp',
    'google cloud',
    'gce',
    'bigquery',
  ]),
  d('cloudrun', 'cloudrun/cloudrun-original.svg', 'Cloud Run', ['cloud run']),
  d('azuredevops', 'azuredevops/azuredevops-original.svg', 'Azure DevOps', ['azure devops']),
  d('azure', 'azure/azure-original.svg', 'Azure', ['azure']),
  d('cloudflare', 'cloudflare/cloudflare-original.svg', 'Cloudflare', ['cloudflare']),
  d('digitalocean', 'digitalocean/digitalocean-original.svg', 'DigitalOcean', [
    'digitalocean',
    'digital ocean',
  ]),
  d('heroku', 'heroku/heroku-original.svg', 'Heroku', ['heroku']),
  d('vercel', 'vercel/vercel-original.svg', 'Vercel', ['vercel'], true),
  d('netlify', 'netlify/netlify-original.svg', 'Netlify', ['netlify']),
  d('firebase', 'firebase/firebase-original.svg', 'Firebase', ['firebase']),
  d('supabase', 'supabase/supabase-original.svg', 'Supabase', ['supabase']),
  d('openstack', 'openstack/openstack-original.svg', 'OpenStack', ['openstack']),
  // Containers & orchestration
  d('helm', 'helm/helm-original.svg', 'Helm', ['helm'], true),
  d('argocd', 'argocd/argocd-original.svg', 'Argo CD', ['argocd', 'argo cd', 'argo']),
  d('k3s', 'k3s/k3s-original.svg', 'K3s', ['k3s']),
  d('rancher', 'rancher/rancher-original.svg', 'Rancher', ['rancher']),
  d('kubernetes', 'kubernetes/kubernetes-original.svg', 'Kubernetes', [
    'kubernetes',
    'k8s',
    'kubectl',
    'eks',
    'aks',
    'gke',
    'kustomize',
  ]),
  d('podman', 'podman/podman-original.svg', 'Podman', ['podman']),
  d('harbor', 'harbor/harbor-original.svg', 'Harbor', []),
  d('docker', 'docker/docker-original.svg', 'Docker', ['docker', 'dockerfile', 'docker compose']),
  // Infrastructure as code & HashiCorp
  d('terraform', 'terraform/terraform-original.svg', 'Terraform', ['terraform', 'opentofu']),
  d('pulumi', 'pulumi/pulumi-original.svg', 'Pulumi', ['pulumi']),
  d('ansible', 'ansible/ansible-original.svg', 'Ansible', ['ansible'], true),
  d('packer', 'packer/packer-original.svg', 'Packer', ['packer']),
  d('vagrant', 'vagrant/vagrant-original.svg', 'Vagrant', ['vagrant']),
  d('vault', 'vault/vault-original.svg', 'Vault', ['vault']),
  d('consul', 'consul/consul-original.svg', 'Consul', ['consul']),
  d('nomad', 'nomad/nomad-original.svg', 'Nomad', []),
  // CI/CD & source control
  d('github-actions', 'githubactions/githubactions-original.svg', 'GitHub Actions', ['github actions']),
  d('github', 'github/github-original.svg', 'GitHub', ['github'], true),
  d('gitlab', 'gitlab/gitlab-original.svg', 'GitLab', ['gitlab']),
  d('bitbucket', 'bitbucket/bitbucket-original.svg', 'Bitbucket', ['bitbucket']),
  d('jenkins', 'jenkins/jenkins-original.svg', 'Jenkins', ['jenkins']),
  d('circleci', 'circleci/circleci-plain.svg', 'CircleCI', ['circleci'], true),
  d('sonarqube', 'sonarqube/sonarqube-original.svg', 'SonarQube', ['sonarqube', 'sonar'], true),
  d('git', 'git/git-original.svg', 'Git', ['git']),
  // Observability
  d('prometheus', 'prometheus/prometheus-original.svg', 'Prometheus', [
    'prometheus',
    'promql',
    'alertmanager',
  ]),
  d('grafana', 'grafana/grafana-original.svg', 'Grafana', ['grafana']),
  d('datadog', 'datadog/datadog-original.svg', 'Datadog', ['datadog']),
  d('dynatrace', 'dynatrace/dynatrace-original.svg', 'Dynatrace', ['dynatrace']),
  d('opentelemetry', 'opentelemetry/opentelemetry-original.svg', 'OpenTelemetry', ['opentelemetry', 'otel']),
  d('jaeger', 'jaegertracing/jaegertracing-original.svg', 'Jaeger', ['jaeger']),
  d('sentry', 'sentry/sentry-original.svg', 'Sentry', ['sentry'], true),
  d('elasticsearch', 'elasticsearch/elasticsearch-original.svg', 'Elasticsearch', ['elasticsearch', 'elk']),
  d('kibana', 'kibana/kibana-original.svg', 'Kibana', ['kibana']),
  d('logstash', 'logstash/logstash-original.svg', 'Logstash', ['logstash']),
  // Networking
  d('nginx', 'nginx/nginx-original.svg', 'NGINX', ['nginx']),
  d('traefik', 'traefikproxy/traefikproxy-original.svg', 'Traefik', ['traefik']),
  d('envoy', 'envoy/envoy-original.svg', 'Envoy', []),
  // Data & messaging
  d('postgresql', 'postgresql/postgresql-original.svg', 'PostgreSQL', ['postgresql', 'postgres', 'psql']),
  d('mysql', 'mysql/mysql-original.svg', 'MySQL', ['mysql'], true),
  d('mariadb', 'mariadb/mariadb-original.svg', 'MariaDB', ['mariadb'], true),
  d('mongodb', 'mongodb/mongodb-original.svg', 'MongoDB', ['mongodb', 'mongo']),
  d('redis', 'redis/redis-original.svg', 'Redis', ['redis', 'valkey']),
  d('sqlite', 'sqlite/sqlite-original.svg', 'SQLite', ['sqlite']),
  d('dynamodb', 'dynamodb/dynamodb-original.svg', 'DynamoDB', ['dynamodb']),
  d('cassandra', 'cassandra/cassandra-original.svg', 'Cassandra', ['cassandra']),
  d('influxdb', 'influxdb/influxdb-original.svg', 'InfluxDB', ['influxdb'], true),
  d('kafka', 'apachekafka/apachekafka-original.svg', 'Kafka', ['kafka'], true),
  d('rabbitmq', 'rabbitmq/rabbitmq-original.svg', 'RabbitMQ', ['rabbitmq']),
  d('nats', 'nats/nats-original.svg', 'NATS', ['nats']),
  // Systems & tools
  d('ubuntu', 'ubuntu/ubuntu-original.svg', 'Ubuntu', ['ubuntu']),
  d('debian', 'debian/debian-original.svg', 'Debian', ['debian']),
  d('redhat', 'redhat/redhat-original.svg', 'Red Hat', ['red hat', 'redhat', 'rhel']),
  d('fedora', 'fedora/fedora-original.svg', 'Fedora', ['fedora']),
  d('archlinux', 'archlinux/archlinux-original.svg', 'Arch Linux', ['arch linux', 'archlinux']),
  d('proxmox', 'proxmox/proxmox-original.svg', 'Proxmox', ['proxmox']),
  d('raspberrypi', 'raspberrypi/raspberrypi-original.svg', 'Raspberry Pi', ['raspberry pi', 'raspberrypi']),
  d('linux', 'linux/linux-original.svg', 'Linux', ['linux']),
  d('windows', 'windows11/windows11-original.svg', 'Windows', ['windows']),
  d('apple', 'apple/apple-original.svg', 'Apple', ['macos'], true),
  d('android', 'android/android-original.svg', 'Android', ['android']),
  d('bash', 'bash/bash-original.svg', 'Bash', ['bash', 'shell scripting'], true),
  d('powershell', 'powershell/powershell-original.svg', 'PowerShell', ['powershell']),
  d('ssh', 'ssh/ssh-original.svg', 'SSH', ['ssh'], true),
  d('tmux', 'tmux/tmux-original.svg', 'tmux', ['tmux']),
  d('neovim', 'neovim/neovim-original.svg', 'Neovim', ['neovim', 'nvim']),
  d('vim', 'vim/vim-original.svg', 'Vim', ['vim']),
  d('vscode', 'vscode/vscode-original.svg', 'VS Code', ['vscode', 'vs code', 'visual studio code']),
  d('oauth', 'oauth/oauth-original.svg', 'OAuth', ['oauth'], true),
  d('okta', 'okta/okta-original.svg', 'Okta', ['okta']),
  // Languages & formats
  d('python', 'python/python-original.svg', 'Python', ['python']),
  d('go', 'go/go-original.svg', 'Go', ['go', 'golang']),
  d('rust', 'rust/rust-original.svg', 'Rust', ['rust'], true),
  d('java', 'java/java-original.svg', 'Java', ['java']),
  d('kotlin', 'kotlin/kotlin-original.svg', 'Kotlin', ['kotlin']),
  d('typescript', 'typescript/typescript-original.svg', 'TypeScript', ['typescript']),
  d('javascript', 'javascript/javascript-original.svg', 'JavaScript', ['javascript']),
  d('nodejs', 'nodejs/nodejs-original.svg', 'Node.js', ['nodejs', 'node js']),
  d('deno', 'denojs/denojs-original.svg', 'Deno', ['deno'], true),
  d('bun', 'bun/bun-original.svg', 'Bun', []),
  d('react', 'react/react-original.svg', 'React', ['react']),
  d('ruby', 'ruby/ruby-original.svg', 'Ruby', ['ruby']),
  d('php', 'php/php-original.svg', 'PHP', ['php']),
  d('csharp', 'csharp/csharp-original.svg', 'C#', ['csharp', 'dotnet']),
  d('cplusplus', 'cplusplus/cplusplus-original.svg', 'C++', ['cpp']),
  d('c', 'c/c-original.svg', 'C'),
  d('swift', 'swift/swift-original.svg', 'Swift', ['swift']),
  d('html5', 'html5/html5-original.svg', 'HTML', ['html']),
  d('css3', 'css3/css3-original.svg', 'CSS', ['css']),
  d('graphql', 'graphql/graphql-plain.svg', 'GraphQL', ['graphql']),
  d('json', 'json/json-original.svg', 'JSON', [], true),
  d('yaml', 'yaml/yaml-original.svg', 'YAML', []),
  d('markdown', 'markdown/markdown-original.svg', 'Markdown', ['markdown'], true),
  d('npm', 'npm/npm-original.svg', 'npm', ['npm']),
  d('yarn', 'yarn/yarn-original.svg', 'Yarn', []),
  d('pnpm', 'pnpm/pnpm-original.svg', 'pnpm', ['pnpm']),
  // Work tools
  d('jira', 'jira/jira-original.svg', 'Jira', ['jira']),
  d('confluence', 'confluence/confluence-original.svg', 'Confluence', ['confluence']),
  d('notion', 'notion/notion-original.svg', 'Notion', ['notion'], true),
  d('slack', 'slack/slack-original.svg', 'Slack', ['slack']),
  d('figma', 'figma/figma-original.svg', 'Figma', ['figma']),
]
