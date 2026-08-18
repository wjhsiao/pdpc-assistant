import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AiApp from './AiApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AiApp />
  </StrictMode>,
);
