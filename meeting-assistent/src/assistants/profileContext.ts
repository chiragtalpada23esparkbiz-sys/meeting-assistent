import portfolioData from '../data/portfolio.json';

interface Portfolio {
  personal: {
    name: string;
    title: string;
    years_of_experience: number;
    current_company: string;
    location: string;
  };
  about: {
    short_bio: string;
    detailed_bio: string[];
  };
  experience: Array<{
    title: string;
    company: string;
    start_date: string;
    end_date: string;
    description: string;
    responsibilities: string[];
    achievements: string[];
    technologies: string[];
  }>;
  education: Array<{
    degree: string;
    institution: string;
    field: string;
    gpa: string;
    achievements: string[];
  }>;
  tech_stack: {
    frontend: string[];
    backend: string[];
    database: string[];
    ai_ml: string[];
    devops: string[];
    services: string[];
  };
  expertise_areas: Array<{
    title: string;
    description: string;
  }>;
  projects: Array<{
    title: string;
    subtitle: string;
    description: string;
    role: string;
    duration: string;
    technologies: string[];
    responsibilities: string[];
    achievements: string[];
  }>;
  achievements: Array<{
    title: string;
    description: string;
    year: string;
    organization: string;
  }>;
}

let cachedContext: string | null = null;

function loadPortfolio(): Portfolio {
  return portfolioData as Portfolio;
}

function formatProjectsSummary(projects: Portfolio['projects']): string {
  return projects
    .slice(0, 4)
    .map((p) => `- ${p.title}: ${p.description} (${p.role}, ${p.duration})`)
    .join('\n');
}

function formatKeyAchievements(achievements: Portfolio['achievements']): string {
  const featured = achievements.filter((a) => a.title.includes('1st') || a.title.includes('Runner'));
  return featured
    .slice(0, 4)
    .map((a) => `- ${a.title} (${a.year})`)
    .join('\n');
}

export function buildProfileContext(): string {
  if (cachedContext) return cachedContext;

  const portfolio = loadPortfolio();
  const { personal, about, experience, education, tech_stack, expertise_areas, projects, achievements } = portfolio;

  const currentJob = experience[0];
  const topAchievements = currentJob?.achievements?.slice(0, 5) || [];

  cachedContext = `
=== CANDIDATE PROFILE (This is YOU - the person being interviewed) ===

NAME: ${personal.name}
TITLE: ${personal.title}
EXPERIENCE: ${personal.years_of_experience}+ years
CURRENT ROLE: ${currentJob?.title} at ${currentJob?.company} (${currentJob?.start_date} - ${currentJob?.end_date})
LOCATION: ${personal.location}

PROFESSIONAL SUMMARY:
${about.short_bio}

CORE EXPERTISE:
${expertise_areas.map((e) => `- ${e.title}: ${e.description}`).join('\n')}

TECH STACK:
- Frontend: ${tech_stack.frontend.join(', ')}
- Backend: ${tech_stack.backend.join(', ')}
- Database: ${tech_stack.database.join(', ')}
- AI/ML: ${tech_stack.ai_ml.join(', ')}
- DevOps: ${tech_stack.devops.join(', ')}

KEY PROFESSIONAL ACHIEVEMENTS:
${topAchievements.map((a) => `- ${a}`).join('\n')}

NOTABLE PROJECTS:
${formatProjectsSummary(projects)}

EDUCATION:
- ${education[0]?.degree} from ${education[0]?.institution} (GPA: ${education[0]?.gpa})
- ${education[1]?.degree} from ${education[1]?.institution} (GPA: ${education[1]?.gpa})

COMPETITIVE ACHIEVEMENTS:
${formatKeyAchievements(achievements)}

=== END OF CANDIDATE PROFILE ===
`.trim();

  return cachedContext;
}

export function clearProfileCache(): void {
  cachedContext = null;
}
