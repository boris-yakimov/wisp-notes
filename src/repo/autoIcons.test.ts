import { iconNames } from 'lucide-react/dynamic'
import { LOGO_LIST } from '../components/logoList.ts'
import { RULE_ICONS, suggestIcon } from './autoIcons.ts'

describe('suggestIcon', () => {
  it('only uses real Lucide icon names', () => {
    const valid = new Set<string>(iconNames)
    expect(RULE_ICONS.filter((i) => !valid.has(i))).toEqual([])
  })

  it('only uses logos that exist, with whole-word keywords', () => {
    const ids = new Set(LOGO_LIST.map((l) => l.id))
    expect(ids.size).toBe(LOGO_LIST.length)
    for (const l of LOGO_LIST) for (const k of l.keywords) expect(k).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/)
  })

  it.each([
    ['Kubernetes', 'logo:kubernetes'],
    ['k8s networking', 'logo:kubernetes'], // a tool's logo wins over a generic word
    ['EKS upgrades', 'logo:kubernetes'],
    ['Helm charts for Kubernetes', 'logo:helm'],
    ['Docker Compose.md', 'logo:docker'],
    ['Terraform modules', 'logo:terraform'],
    ['Ansible', 'logo:ansible'],
    ['GitHub Actions', 'logo:github-actions'],
    ['GitHub', 'logo:github'],
    ['Git', 'logo:git'],
    ['AWS', 'logo:aws'],
    ['S3 buckets', 'logo:aws'],
    ['GCP', 'logo:gcp'],
    ['Google Cloud', 'logo:gcp'],
    ['Azure', 'logo:azure'],
    ['Nginx', 'logo:nginx'],
    ['Prometheus & Grafana', 'logo:prometheus'],
    ['PostgreSQL', 'logo:postgresql'],
    ['Kafka', 'logo:kafka'],
    ['Linux commands', 'logo:linux'],
    ['Bash scripting', 'logo:bash'],
    ['Python', 'logo:python'],
    ['SSH keys', 'logo:ssh'],
    // No logo: generic topics keep their Lucide icon.
    ['CI/CD', 'workflow'],
    ['TLS certificates', 'lock'],
    ['IAM', 'shield'],
    ['DNS', 'network'],
    ['Logging', 'scroll-text'],
    ['Incident response', 'siren'],
    ['Backups', 'archive'],
    ['Cron jobs', 'clock'],
    ['Interview questions', 'message-circle-question'],
    ['Digital nomad', undefined],
  ])('%s → %s', (title, icon) => expect(suggestIcon(title)).toBe(icon))

  it('matches whole words only and returns undefined when nothing fits', () => {
    expect(suggestIcon('Digital garden')).toBeUndefined() // "git" inside a word
    expect(suggestIcon('Groceries')).toBeUndefined()
    expect(suggestIcon('Untitled')).toBeUndefined()
  })
})
