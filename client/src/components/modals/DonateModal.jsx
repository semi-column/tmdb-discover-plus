import { Heart, Github, ArrowUpRight } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

const KofiIcon = ({ size = 20, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`lucide lucide-kofi ${className}`}
  >
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M4 8h14v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
    <path d="M11.64 15.3l-2.61-2.6a1.9 1.9 0 0 1 2.68-2.68l.29.28.29-.28a1.9 1.9 0 0 1 2.68 2.68l-2.6 2.6a.43.43 0 0 1-.73.01z" />
  </svg>
);

// Note: Ensure that we have a simple Kofi icon or use an image, but we can use lucid-react generic or text.
export function DonateModal({ isOpen, onClose }) {
  const modalRef = useModalA11y(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div
        className="modal donate-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Support the project"
        style={{ maxWidth: '440px' }}
      >
        <div className="modal-header donate-modal-header">
          <div className="donate-modal-heart">
            <Heart size={22} fill="currentColor" />
          </div>
          <h2 className="modal-title">Support the Project</h2>
        </div>

        <div className="modal-body donate-modal-body">
          <div className="donate-options">
            <a
              href="https://github.com/sponsors/semi-column"
              target="_blank"
              rel="noopener noreferrer"
              className="donate-btn donate-gh"
            >
              <span className="donate-option-icon donate-option-icon-github">
                <Github size={20} />
              </span>
              <span>GitHub Sponsors</span>
              <ArrowUpRight size={18} className="donate-option-arrow" />
            </a>

            <a
              href="https://ko-fi.com/semicolumn"
              target="_blank"
              rel="noopener noreferrer"
              className="donate-btn donate-kofi"
            >
              <span className="donate-option-icon donate-option-icon-kofi">
                <KofiIcon size={20} />
              </span>
              <span>Ko-fi</span>
              <ArrowUpRight size={18} className="donate-option-arrow" />
            </a>
          </div>
        </div>

        <div className="modal-footer donate-modal-footer">
          <button className="btn btn-secondary donate-close-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <style
          dangerouslySetInnerHTML={{
            __html: `
          .donate-modal-header {
            justify-content: flex-start;
            gap: 14px;
            padding: 20px 22px;
          }

          .donate-modal-heart {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            flex: 0 0 42px;
            color: #ff5c8a;
            background: rgba(255, 92, 138, 0.12);
            border: 1px solid rgba(255, 92, 138, 0.3);
            border-radius: 12px;
          }

          .donate-modal-header .modal-title {
            margin: 0;
            font-size: 1.05rem;
            letter-spacing: 0;
          }

          .donate-modal-body {
            padding: 22px;
          }

          .donate-options {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .donate-btn {
            display: flex;
            align-items: center;
            gap: 13px;
            min-height: 64px;
            padding: 11px 14px;
            border-radius: 10px;
            text-decoration: none;
            background: var(--surface-color);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            transition: all 0.2s ease;
            font-weight: 500;
          }

          .donate-option-icon {
            width: 38px;
            height: 38px;
            display: grid;
            place-items: center;
            flex: 0 0 38px;
            border-radius: 9px;
          }

          .donate-option-icon-github {
            color: #f0f6fc;
            background: rgba(240, 246, 252, 0.1);
          }

          .donate-option-icon-kofi {
            color: #ff5c8a;
            background: rgba(255, 92, 138, 0.12);
          }

          .donate-option-arrow {
            margin-left: auto;
            color: var(--text-secondary);
            transition: transform 0.2s ease, color 0.2s ease;
          }

          .donate-btn:hover {
            background: var(--hover-color) !important;
            border-color: var(--primary-color) !important;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }

          .donate-btn:hover .donate-option-arrow {
            color: var(--text-primary);
            transform: translate(2px, -2px);
          }

          .donate-modal-footer {
            justify-content: flex-end;
            padding: 16px 22px;
          }

          .donate-close-btn {
            min-width: 92px;
          }

          @media (max-width: 767px) {
            .donate-modal {
              margin: auto !important;
              max-width: calc(100% - 32px) !important;
              border-radius: var(--radius-lg) !important;
              max-height: 90vh;
            }
            .modal-overlay:has(.donate-modal) {
              align-items: center;
              padding: 16px;
            }
          }
        `,
          }}
        />
      </div>
    </div>
  );
}
