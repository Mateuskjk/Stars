// Formatação usada em várias telas (iniciais nos avatares, horário curto)
export function initials(name: string) {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('');
}

// Hoje: "14:32"; outros dias: "05/10"
export function formatTime(date: Date, now = new Date()) {
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
