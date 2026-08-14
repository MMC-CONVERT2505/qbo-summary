import mmcLogo from '../assets/mmc-logo.png';

/** Just the brand mark, floating over the screen flow — no bar, no product label. */
export default function AppBar() {
  return (
    <a className="brandmark" href="#" aria-label="MMC home">
      <img src={mmcLogo} alt="MMC" />
    </a>
  );
}
