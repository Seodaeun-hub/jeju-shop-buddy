export function Citrus({ stamp = false }: { stamp?: boolean }) {
  return <span aria-hidden="true" className={stamp ? 'citrus-stamp' : 'brand-mark'}><span className="citrus" /></span>
}

export function PageTitle({ title, detail }: { title: string; detail?: string }) {
  return <header className="page-heading"><h1>{title}</h1>{detail && <p>{detail}</p>}</header>
}
