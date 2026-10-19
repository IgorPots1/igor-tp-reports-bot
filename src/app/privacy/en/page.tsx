import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import HtmlLang from "../../coaching/HtmlLang";
import { jetbrains, onest } from "@/lib/fonts";
import {
  PRIVACY_EN_CONTACT_EMAIL,
  PRIVACY_EN_PATH,
  PRIVACY_EN_UPDATED,
  PRIVACY_EN_VERSION,
} from "@/lib/privacy-en";
import { publicPageMetadata } from "@/lib/site";

// English privacy notice for the international forms (/coaching/start and
// /trial/apply). Both forms link here from a required consent checkbox and
// store PRIVACY_EN_VERSION with the consent, so: change the text, then bump
// the version and the date in src/lib/privacy-en.ts.
//
// Same look as the Russian /privacy (inline styles on purpose, no outside
// classes), plain English for non-native readers, no em or en dashes.
// clubImage + lang "en" give the English link preview: without it the page
// would inherit the Russian opengraph-image.tsx of /privacy.
export const metadata: Metadata = publicPageMetadata({
  path: PRIVACY_EN_PATH,
  title: "Privacy notice · Igor Potseluev, running coach",
  description:
    "What data igorp.run collects in the coaching forms, why, where it is stored, who receives it and how to delete it.",
  siteName: "Igor · running coach",
  clubImage: true,
  lang: "en",
});

const BG = "#F6F4EF";
const SURFACE = "#FFFFFF";
const INK = "#16150F";
const INK_2 = "#4D483F";
const MUTED = "#857F73";
const LINE = "#E7E1D5";
const ACCENT = "#E5480E";
const GREEN = "#2E7D45";
const GREEN_BG = "#EAF3EC";

const SANS = "var(--font-onest), 'Onest', system-ui, sans-serif";
const MONO = "var(--font-jetbrains), 'JetBrains Mono', ui-monospace, monospace";

const rootStyle: CSSProperties = {
  minHeight: "100vh",
  background: BG,
  color: INK,
  fontFamily: SANS,
  fontSize: "17px",
  lineHeight: 1.6,
  WebkitFontSmoothing: "antialiased",
};

const mainStyle: CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  padding: "56px 22px 72px",
};

const eyebrowStyle: CSSProperties = {
  display: "block",
  fontFamily: MONO,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: ACCENT,
};

const h1Style: CSSProperties = {
  margin: "14px 0 0",
  fontSize: "clamp(30px, 5vw, 44px)",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.06,
};

const leadStyle: CSSProperties = {
  margin: "18px 0 0",
  fontSize: "clamp(16px, 1.6vw, 19px)",
  color: INK_2,
};

const metaStyle: CSSProperties = {
  margin: "22px 0 0",
  paddingTop: "18px",
  borderTop: `1px solid ${LINE}`,
  fontFamily: MONO,
  fontSize: "12.5px",
  color: MUTED,
  letterSpacing: "0.02em",
};

const sectionStyle: CSSProperties = {
  background: SURFACE,
  border: `1px solid ${LINE}`,
  borderRadius: "14px",
  padding: "24px 22px",
  marginTop: "14px",
};

const sectionNumberStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.14em",
  color: ACCENT,
};

const h2Style: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "clamp(19px, 2.2vw, 23px)",
  fontWeight: 700,
  letterSpacing: "-0.015em",
  lineHeight: 1.2,
};

const bodyStyle: CSSProperties = {
  margin: "12px 0 0",
  color: INK_2,
};

const listStyle: CSSProperties = {
  margin: "12px 0 0",
  paddingLeft: "20px",
  display: "grid",
  gap: "8px",
  color: INK_2,
};

const linkStyle: CSSProperties = {
  color: ACCENT,
  textDecoration: "none",
  fontWeight: 600,
  overflowWrap: "anywhere",
};

const contactStyle: CSSProperties = {
  ...sectionStyle,
  background: GREEN_BG,
  border: `1px solid ${GREEN}`,
  marginTop: "26px",
};

const footerStyle: CSSProperties = {
  margin: "34px 0 0",
  paddingTop: "20px",
  borderTop: `1px solid ${LINE}`,
  fontSize: "14px",
  color: MUTED,
};

type SectionProps = {
  number: string;
  title: string;
  children: ReactNode;
};

function Section({ number, title, children }: SectionProps) {
  return (
    <section style={sectionStyle}>
      <span style={sectionNumberStyle}>{number}</span>
      <h2 style={h2Style}>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyEnPage() {
  const mailto = `mailto:${PRIVACY_EN_CONTACT_EMAIL}`;
  const email = (
    <a style={linkStyle} href={mailto}>
      {PRIVACY_EN_CONTACT_EMAIL}
    </a>
  );

  return (
    <div lang="en" style={rootStyle} className={`${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      <main style={mainStyle}>
        <span style={eyebrowStyle}>igorp.run · your data</span>
        <h1 style={h1Style}>Privacy notice</h1>
        <p style={leadStyle}>
          This page explains what data I collect when you fill in my coaching
          forms, why I need it, where it is stored, who can see it and how to
          delete it. I use your data only to coach you.
        </p>
        <p style={metaStyle}>
          Last updated: {PRIVACY_EN_UPDATED} · version {PRIVACY_EN_VERSION}
        </p>

        <Section number="01" title="Who is responsible for your data">
          <p style={bodyStyle}>
            Igor Potseluev, running and triathlon coach, igorp.run. I work as an
            individual coach. There is no company behind this service. I decide
            how your data is used, so I am the &ldquo;controller&rdquo; of your
            data.
          </p>
          <p style={bodyStyle}>Contact for any question about your data: {email}.</p>
        </Section>

        <Section number="02" title="What data I collect">
          <p style={bodyStyle}>
            This notice covers the coaching form (igorp.run/coaching/start) and
            the trial week form (igorp.run/trial/apply). I collect:
          </p>
          <ul style={listStyle}>
            <li>
              <strong>About you:</strong> your name, city and country, time zone,
              date of birth and sex, if you give them. In the trial form also your
              Instagram handle, WhatsApp number and email, if you give it.
            </li>
            <li>
              <strong>Your training:</strong> your goals and races, the sports you
              do, your current training week, your free days and times, your
              longest sessions, results and personal bests, your devices and
              apps.
            </li>
            <li>
              <strong>Health information:</strong> injuries, health conditions and
              medications that affect training, sleep, energy level, and anything
              you choose to tell me about your health or menstrual cycle. This is
              sensitive data, so I ask for your explicit consent before you send
              it.
            </li>
            <li>
              <strong>Training data you share:</strong> workouts, heart rate, pace,
              power and similar data from Strava, TrainingPeaks, Garmin Connect or
              other apps, when you give me access or send it to me.
            </li>
            <li>
              <strong>Our messages:</strong> what you write to me while I coach
              you.
            </li>
            <li>
              <strong>Technical data:</strong> if you open the form from my
              message, the link has a short chat code, so I can match your form to
              our chat. I also save the date and time when you agreed to this
              notice and the version of the notice.
            </li>
          </ul>
        </Section>

        <Section number="03" title="Why I use it">
          <ul style={listStyle}>
            <li>to build your training plan and change it as you progress;</li>
            <li>to choose a safe training load and lower the risk of injury;</li>
            <li>to review your workouts and give you feedback;</li>
            <li>to talk with you about your training.</li>
          </ul>
          <p style={bodyStyle}>
            I do not use your data for advertising. I do not sell it. I do not
            show your answers or your training to other clients without your
            permission.
          </p>
        </Section>

        <Section number="04" title="Legal basis">
          <p style={bodyStyle}>
            I process your data because you agree to it (your consent). For your
            health information I ask for your explicit consent: you give it with
            the checkbox in the form. Without this consent I cannot accept the
            form, because I cannot plan safe training without knowing about your
            health.
          </p>
        </Section>

        <Section number="05" title="Where your data is stored">
          <p style={bodyStyle}>
            Your form answers are stored in a database run by Supabase, a cloud
            database service. The website runs on Vercel. These services may store
            and process data on servers outside your country. Access to the
            database is protected and only I can see your answers.
          </p>
        </Section>

        <Section number="06" title="Who receives your data">
          <p style={bodyStyle}>
            I never sell your data. I share it only with service providers that
            I need to run the service, and only as much as each one needs:
          </p>
          <ul style={listStyle}>
            <li>
              <strong>Vercel:</strong> website hosting. Your form passes through
              it.
            </li>
            <li>
              <strong>Supabase:</strong> the database where your answers are
              stored.
            </li>
            <li>
              <strong>Telegram:</strong> when you send a form, I get a short
              notification in Telegram with your name, city, sports and goal. Your
              health answers are not in this notification.
            </li>
            <li>
              <strong>AI tools:</strong> I may use an AI language model provider to
              help me prepare plans and workout feedback. The provider does not use
              your data to train its models. I check everything myself before you
              get it.
            </li>
          </ul>
          <p style={bodyStyle}>
            We talk in Instagram, WhatsApp or Telegram, and you may share data with
            me through Strava or TrainingPeaks. These apps have their own privacy
            policies.
          </p>
        </Section>

        <Section number="07" title="How long I keep it">
          <p style={bodyStyle}>
            I keep your data while I coach you and for up to 12 months after we
            stop, in case you come back and so I can answer questions about past
            training. After that I delete it. If you ask me to delete it earlier, I
            do.
          </p>
        </Section>

        <Section number="08" title="Your rights">
          <p style={bodyStyle}>You can at any time:</p>
          <ul style={listStyle}>
            <li>ask what data I have about you and get a copy;</li>
            <li>ask me to correct data that is wrong;</li>
            <li>ask me to delete your data;</li>
            <li>
              withdraw your consent. This does not make earlier processing
              unlawful, but I stop using your data from that moment;
            </li>
            <li>
              complain to a data protection authority in your country if you
              think I handle your data wrongly.
            </li>
          </ul>
        </Section>

        <Section number="09" title="How to withdraw consent or delete your data">
          <p style={bodyStyle}>
            Send me a message in the chat where we talk, or write to {email}. Tell
            me what you want: a copy, a correction, or deletion. I reply within 30
            days, usually much faster, and confirm when it is done.
          </p>
        </Section>

        <Section number="10" title="Website statistics">
          <p style={bodyStyle}>
            The site counts page views with Vercel Web Analytics and its own simple
            counter. The counter uses a random ID in your browser storage, not your
            name or contact details. There are no advertising trackers.
          </p>
        </Section>

        <Section number="11" title="Changes to this notice">
          <p style={bodyStyle}>
            If I change this notice, I change the date and version at the top of
            this page. If a change means I collect more data, I tell my clients
            directly.
          </p>
        </Section>

        <section style={contactStyle}>
          <span style={{ ...sectionNumberStyle, color: GREEN }}>contact</span>
          <h2 style={h2Style}>Questions about your data</h2>
          <p style={{ ...bodyStyle, color: INK }}>
            Write to{" "}
            <a style={{ ...linkStyle, color: GREEN }} href={mailto}>
              {PRIVACY_EN_CONTACT_EMAIL}
            </a>{" "}
            or message me in our chat. I answer personally. Use the same contact
            to ask for a copy of your data or to delete it.
          </p>
        </section>

        <p style={footerStyle}>
          <a style={linkStyle} href="/coaching">
            &larr; Back to coaching
          </a>
        </p>
      </main>
    </div>
  );
}
