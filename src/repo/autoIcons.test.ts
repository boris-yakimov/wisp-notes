import { iconNames } from 'lucide-react/dynamic'
import { RULE_ICONS, suggestIcon } from './autoIcons.ts'

describe('suggestIcon', () => {
  it('only uses real Lucide icon names', () => {
    const valid = new Set<string>(iconNames)
    expect(RULE_ICONS.filter((i) => !valid.has(i))).toEqual([])
  })

  it.each([
    ['Kubernetes', 'ship-wheel'],
    ['k8s networking', 'ship-wheel'], // specific tool wins over a generic word
    ['Docker Compose.md', 'container'],
    ['Terraform modules', 'layers'],
    ['Ansible', 'wrench'],
    ['GitHub Actions', 'workflow'],
    ['CI/CD', 'workflow'],
    ['Git', 'git-branch'],
    ['AWS', 'cloud'],
    ['SSH keys', 'key-round'],
    ['TLS certificates', 'lock'],
    ['IAM', 'shield'],
    ['DNS', 'network'],
    ['Nginx', 'network'],
    ['Prometheus & Grafana', 'activity'],
    ['Logging', 'scroll-text'],
    ['Incident response', 'siren'],
    ['PostgreSQL', 'database'],
    ['Backups', 'archive'],
    ['Kafka', 'messages-square'],
    ['Linux commands', 'terminal'],
    ['Bash scripting', 'terminal'],
    ['Cron jobs', 'clock'],
    ['Python', 'code'],
    ['Interview questions', 'message-circle-question'],
  ])('%s → %s', (title, icon) => expect(suggestIcon(title)).toBe(icon))

  it('matches whole words only and returns undefined when nothing fits', () => {
    expect(suggestIcon('Digital garden')).toBeUndefined() // "git" inside a word
    expect(suggestIcon('Groceries')).toBeUndefined()
    expect(suggestIcon('Untitled')).toBeUndefined()
  })
})
