import { render } from 'preact';
import '../../comum/estilo.css';
import { acompanharAltura, sdk } from '../../comum/omni';
import { App } from './app';
import './painel.css';

const omni = sdk();
omni.ready((ctx) => {
  render(<App omni={omni} ctx={ctx ?? {}} />, document.getElementById('app')!);
  acompanharAltura();
});
