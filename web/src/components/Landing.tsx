/*
 * First view for a visitor with nothing saved yet. The page's argument is the
 * demo: a red pencil mark stops on one site's timesheet row and is carried,
 * minute for minute, onto another site's row.
 */
import type { Mode } from "../lib/store";
import { Icon } from "./Icon";
import { useUi } from "./ui";

interface Props {
  mode: Mode;
  onSample?: () => void;
}

const STEPS: { title: string; body: string; pos: number; sync?: boolean }[] = [
  {
    title: "Watch on any site",
    body: "The extension finds the player, even inside embedded frames, and reads which series and episode it is.",
    pos: 0.32,
  },
  {
    title: "Kumostamp marks where you stop",
    body: "On every pause, and every few seconds while you watch. Each episode keeps the minute you reached, and which site you were on.",
    pos: 0.77,
  },
  {
    title: "Pick it up anywhere else",
    body: "Open the same episode on another site and it jumps to your mark. A fresh start at 0:00 never overwrites it.",
    pos: 0.77,
    sync: true,
  },
];

export function Landing({ mode, onSample }: Props) {
  const { openAdd } = useUi();
  const untrusted = mode === "untrusted";
  const local = mode === "local";

  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing-hero">
        <div className="landing-copy">
          <h2 id="landing-title">
            <span className="landing-line">Stop at <span className="landing-time">18:24</span> on one site.</span>{" "}
            <span className="landing-line">Resume at <span className="landing-time">18:24</span> on the next.</span>
          </h2>
          <p className="landing-lede">
            Kumostamp saves the minute you stopped in every anime, series and movie. Open the same episode on another streaming site and the player starts from there.
          </p>
          <div className="landing-actions">
            {local && (
              <a className="btn btn-ink btn-lg" href="#install">
                <Icon name="down" />
                Install the extension
              </a>
            )}
            <button className={`btn btn-lg${local ? "" : " btn-ink"}`} type="button" onClick={() => openAdd({})}>
              <Icon name="plus" />
              Add a series by hand
            </button>
            {onSample && (
              <button className="linklike landing-sample" type="button" onClick={onSample}>
                or see a sample sheet first
              </button>
            )}
          </div>
          {untrusted && (
            <p className="landing-allow">
              <strong>The extension is installed.</strong> Click the Kumostamp icon on this tab and press “Use this page as my library” to show your marks here.
            </p>
          )}
          {mode === "extension" && (
            <p className="landing-allow">
              <strong>Extension connected.</strong> Play an episode anywhere; your first mark lands here the moment you pause.
            </p>
          )}
        </div>

        <figure className="demo" aria-label="Example: a mark made at 18:24 on one site is resumed at 18:24 on another">
          <div className="demo-head">
            <span className="cell-label">Sample</span>
            <span className="demo-title">JoJo’s Bizarre Adventure: Stone Ocean</span>
            <span className="demo-ep">EP 02</span>
          </div>
          <div className="demo-row demo-a">
            <span className="demo-site">provider-a.example</span>
            <div className="demo-ruler">
              <span className="demo-mark" />
            </div>
            <span className="demo-stamp">stopped 18:24</span>
          </div>
          <div className="demo-carry" aria-hidden="true">
            <span>carried over</span>
          </div>
          <div className="demo-row demo-b">
            <span className="demo-site">provider-b.example</span>
            <div className="demo-ruler">
              <span className="demo-mark" />
            </div>
            <span className="demo-stamp">resumed 18:24</span>
          </div>
          <figcaption className="demo-foot">
            <span>00:00</span>
            <span>24:00</span>
          </figcaption>
        </figure>
      </div>

      <ol className="landing-steps">
        {STEPS.map((s) => (
          <li key={s.title}>
            <div className="ls-text">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
            <div className={`ls-ruler${s.sync ? " is-sync" : ""}`} style={{ "--pos": String(s.pos) } as React.CSSProperties} aria-hidden="true">
              <span className="ruler-mark" />
            </div>
          </li>
        ))}
      </ol>

      <dl className="landing-facts">
        <div>
          <dt>Synopsis and posters</dt>
          <dd>Linked automatically from AniList, TVmaze and IMDb, with a one-click fix when the match is a guess.</dd>
        </div>
        <div>
          <dt>Works with</dt>
          <dd>Any site with an HTML5 player, including embedded frames. Netflix through its own player.</dd>
        </div>
        <div>
          <dt>Your data</dt>
          <dd>Stays in your browser unless you sign in with MyAnimeList, which keeps a copy on the Kumostamp server so your other browsers get it. Export and import as JSON whenever you like.</dd>
        </div>
      </dl>

      {local && (
        <div className="landing-install" id="install">
          <h3>Install the extension</h3>
          <ol>
            <li>
              Open <code>chrome://extensions</code> (or <code>brave://extensions</code>) and turn on <strong>Developer mode</strong>.
            </li>
            <li>
              Choose <strong>Load unpacked</strong> and pick the <code>kumotstamp/extension</code> folder.
            </li>
            <li>
              Reload this page. On a hosted copy of this site, click the Kumostamp icon and press <strong>Use this page as my library</strong>.
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
