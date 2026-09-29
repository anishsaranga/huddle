export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="pt-safe px-safe">
      <div className="px-5 pb-4 pt-6">
        {subtitle && <p className="label mb-1">{subtitle}</p>}
        <h1 className="font-display text-[40px] font-bold uppercase leading-none tracking-wide">
          {title}
        </h1>
      </div>
    </header>
  );
}
