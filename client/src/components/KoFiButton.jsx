export function KoFiButton() {
  const color = '#72a4f2';
  const id = 'G2G81SVSVS';
  
  return (
    <a 
      title="Support me on Ko-fi" 
      className="kofi-button" 
      style={{backgroundColor: color}} 
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
      <style>{`
        .kofi-button {
          box-shadow: 1px 1px 0px rgba(0, 0, 0, 0.2);
          line-height: 36px !important;
          min-width: 150px;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          background-color: #72a4f2;
          padding: 2px 12px !important;
          text-align: center !important;
          border-radius: 7px;
          color: #fff;
          cursor: pointer;
          overflow-wrap: break-word;
          vertical-align: middle;
          border: 0 none #fff !important;
          font-family: 'Quicksand', Helvetica, Century Gothic, sans-serif !important;
          text-decoration: none;
          text-shadow: none;
          font-weight: 700 !important;
          font-size: 14px !important;
          height: 36px;
        }
        .kofi-button:hover {
          opacity: 0.85;
          color: #fff !important;
          text-decoration: none !important;
        }
        .kofiimg {
          display: initial;
          vertical-align: middle;
          height: 13px !important;
          width: 20px !important;
          padding: 0 !important;
          margin: 0 5px 0 0 !important;
          border: none;
        }
        .kofitext {
          color: #fff !important;
          letter-spacing: -0.15px !important;
          text-wrap: nowrap !important;
          vertical-align: middle !important;
          line-height: 33px !important;
          padding: 0 !important;
          text-align: center;
          text-decoration: none !important;
          text-shadow: 0 1px 1px rgba(34, 34, 34, 0.05);
        }
      `}</style>
    </a>
  );
}
