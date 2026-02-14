export function KoFiButton() {
  const color = '#72a4f2';
  const id = 'G2G81SVSVS';

  return (
    <a
      title="Support me on Ko-fi"
      className="kofi-button"
      style={{ backgroundColor: color }}
      href={`https://ko-fi.com/${id}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="kofitext">
        <img
          src="https://storage.ko-fi.com/cdn/cup-border.png"
          alt="Ko-fi donation icon"
          className="kofiimg"
        />
        Ko-fi / Paypal
      </span>
    </a>
  );
}
