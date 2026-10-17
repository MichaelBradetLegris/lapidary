import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

/* A file dropped on the window would otherwise be opened in place of the app,
   losing any open paragraph boxes (C.41). Only file drags are stopped; dragging
   text inside the page still works. Main refuses the navigation as well. */
for (const type of ['dragover', 'drop'] as const) {
  document.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
