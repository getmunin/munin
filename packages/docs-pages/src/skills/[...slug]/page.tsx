import { notFound } from 'next/navigation';
import { Link } from '../../i18n-navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { findSkill, groupByModule, renderSkillContent, skills } from '../../_lib/skills';
import { SkillsSidebar } from '../../_components/skills-sidebar';

export function generateStaticParams() {
  return skills.map((s) => ({ slug: [s.module, s.slug] }));
}

export default async function SkillDetail({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const [moduleName, slugName] = slug;
  if (!moduleName || !slugName) notFound();
  const skill = findSkill(moduleName, slugName);
  if (!skill) notFound();
  const groups = groupByModule();
  return (
    <>
      <SkillsSidebar groups={groups} />
      <main className="docs-main">
        <div className="skill-detail">
          <div className="breadcrumb">
            <Link href="/docs/skills">← Back to skills</Link>
            <span className="uri">skill://{skill.module}/{skill.slug}</span>
            <span className="title-pin">{skill.title}</span>
          </div>
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {renderSkillContent(skill.content)}
            </ReactMarkdown>
          </div>
        </div>
      </main>
    </>
  );
}
