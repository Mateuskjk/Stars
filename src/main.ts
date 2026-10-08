import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installErrorCapture } from './app/browser-errors/browser-errors';

// Antes de tudo: começa a registrar os erros do navegador (tela Erros do navegador)
installErrorCapture();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
