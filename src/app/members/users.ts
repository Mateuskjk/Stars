// Pessoas de exemplo (modo sem banco: testes e demonstração)
export interface User {
  id: number;
  name: string;
  role: string;
}

// ponytail: usuários fixos de exemplo; trocar por um service/API (e tempo real) quando o backend existir
export const USERS: User[] = [
  { id: 1, name: 'Ana Souza', role: 'Product Manager' },
  { id: 2, name: 'Carlos Lima', role: 'Desenvolvedor' },
  { id: 3, name: 'Bruna Alves', role: 'Designer' },
  { id: 4, name: 'Diego Rocha', role: 'Desenvolvedor' },
  { id: 5, name: 'Eva Martins', role: 'QA' },
  { id: 6, name: 'Felipe Costa', role: 'Tech Lead' },
  { id: 7, name: 'Gabriela Nunes', role: 'Analista de dados' },
];
