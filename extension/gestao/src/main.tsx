import { render } from 'preact';
import '../../comum/estilo.css';
import { sdk } from '../../comum/omni';
import { App } from './app';
import './gestao.css';

const omni = sdk();
omni.ready((ctx) => {
  render(<App omni={omni} ctx={ctx ?? {}} />, document.getElementById('app')!);
});
