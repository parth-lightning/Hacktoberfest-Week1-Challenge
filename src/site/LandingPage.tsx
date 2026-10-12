import "./landing-page.css";

export default function LandingPage() {
  return (
    <main className="threeui-landing">
      <iframe
        className="threeui-landing__template"
        title="ThreeUI Sylva 3D landing page"
        src="/landing-pages/inner-green-3d.html"
      />
      <div className="threeui-landing__entry">
        <span className="threeui-landing__eyebrow">WILDPACK · LOCAL-FIRST FIELD GUIDE</span>
        <a className="threeui-landing__button" href="/app">
          Open WildPack <span aria-hidden="true">↗</span>
        </a>
      </div>
    </main>
  );
}
