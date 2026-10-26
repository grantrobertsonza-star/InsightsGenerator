import { notFound } from "next/navigation";
import { articles } from "../articles";
import { articleComponents } from "../registry";

export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = articles.find((a) => a.slug === slug);
  return meta ? { title: `${meta.title} · Knowledge base`, description: meta.blurb } : {};
}

export default async function KnowledgeArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const Component = articleComponents[slug];
  if (!Component) notFound();
  return <Component />;
}
