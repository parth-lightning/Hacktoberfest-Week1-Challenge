import { useState, type FormEvent } from "react";
import { SylvaHero } from "@designcodeio/threeui/components/SylvaHero";

type SubmissionState = "idle" | "sending" | "success" | "error";

const projects = [
  {
    number: "01",
    title: "Living landscapes",
    description:
      "Restoring the links between native planting, healthy soil, and thriving wildlife.",
    className: "project-card--landscape",
  },
  {
    number: "02",
    title: "Thoughtful places",
    description:
      "Making places for people and the more-than-human world to flourish together.",
    className: "project-card--place",
  },
  {
    number: "03",
    title: "Shared knowledge",
    description:
      "Helping communities grow practical, lasting care for the places they call home.",
    className: "project-card--knowledge",
  },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [formMessage, setFormMessage] = useState("");

  async function handleContactSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionState("sending");
    setFormMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          message: formData.get("message"),
        }),
      });
      const result = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Your message could not be submitted.");
      }

      setSubmissionState("success");
      setFormMessage(result.message ?? "Thanks for getting in touch.");
      form.reset();
    } catch (error) {
      setSubmissionState("error");
      setFormMessage(
        error instanceof Error
          ? error.message
          : "We could not reach the server. Please try again.",
      );
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#home" onClick={closeMenu}>
          <span className="wordmark-mark" aria-hidden="true">
            ◌
          </span>
          Fieldwork
        </a>
        <button
          className="menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
        <nav
          className={`site-nav${menuOpen ? " site-nav--open" : ""}`}
          id="site-navigation"
          aria-label="Main navigation"
        >
          <a href="#about" onClick={closeMenu}>About</a>
          <a href="#projects" onClick={closeMenu}>Projects</a>
          <a className="nav-contact" href="#contact" onClick={closeMenu}>
            Get in touch <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main>
        <section className="home-section" id="home" aria-label="Introduction">
          <div className="hero-frame">
            <SylvaHero
              headingFont="lexend"
              bodyFont="lexend"
              headingWeight="300"
              bodyWeight="300"
              primaryColor="#ffffff"
              headingSize={63}
              bodySize={16.5}
              headingLetterSpacing={-0.006}
            />
          </div>
          <a className="scroll-cue" href="#about">
            Scroll to explore <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section className="about-section section-shell" id="about">
          <p className="eyebrow">A little more about us</p>
          <div className="about-copy">
            <h1>
              Good work starts by paying attention to the living world around us.
            </h1>
            <div className="about-aside">
              <p>
                We bring people, place, and practical ideas together to help
                nature recover. This is a starting point for your own story:
                replace the name, language, and project details with your
                organization&apos;s.
              </p>
              <a className="text-link" href="#projects">
                See what we do <span aria-hidden="true">↘</span>
              </a>
            </div>
          </div>
          <div className="about-notes" aria-label="Our approach">
            <span>Rooted in place</span>
            <span>Made to last</span>
            <span>Better together</span>
          </div>
        </section>

        <section className="projects-section section-shell" id="projects">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Selected work</p>
              <h2>Small steps, living change.</h2>
            </div>
            <p>
              A few example project stories. Swap these placeholders for your
              own work, outcomes, and photography.
            </p>
          </div>
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.number}>
                <div
                  className={`project-art ${project.className}`}
                  aria-hidden="true"
                >
                  <span className="project-number">{project.number}</span>
                  <span className="project-art-shape" />
                </div>
                <div className="project-copy">
                  <h3>{project.title}</h3>
                  <p>{project.description}</p>
                  <a
                    className="project-link"
                    href="#contact"
                    aria-label={`Ask us about ${project.title}`}
                  >
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="contact-section section-shell" id="contact">
          <div className="contact-intro">
            <p className="eyebrow">Start a conversation</p>
            <h2>Have a place in mind?</h2>
            <p>
              Tell us a little about what you&apos;re working on. We&apos;ll
              make the next step together.
            </p>
            <a className="contact-email" href="mailto:hello@example.com">
              hello@example.com <span aria-hidden="true">↗</span>
            </a>
          </div>
          <form className="contact-form" onSubmit={handleContactSubmit}>
            <label>
              Your name
              <input
                autoComplete="name"
                maxLength={100}
                name="name"
                placeholder="Name"
                required
              />
            </label>
            <label>
              Email address
              <input
                autoComplete="email"
                maxLength={254}
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>
            <label>
              What would you like to share?
              <textarea
                maxLength={5000}
                name="message"
                placeholder="A little about your project..."
                required
                rows={4}
              />
            </label>
            <button
              className="submit-button"
              disabled={submissionState === "sending"}
              type="submit"
            >
              {submissionState === "sending" ? "Sending..." : "Send message"}
              <span aria-hidden="true">↗</span>
            </button>
            <p
              className={`form-message form-message--${submissionState}`}
              aria-live="polite"
              role={submissionState === "error" ? "alert" : "status"}
            >
              {formMessage}
            </p>
            <p className="form-note">
              Starter form only: messages are validated but not saved or emailed.
            </p>
          </form>
        </section>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="#home">
          <span className="wordmark-mark" aria-hidden="true">◌</span>
          Fieldwork
        </a>
        <p>Made with care for the places we share.</p>
        <a href="#home">Back to top ↑</a>
      </footer>
    </>
  );
}

export default App;
