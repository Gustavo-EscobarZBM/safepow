/// Quantidade da perda (SP4 4.1): vírgula ou ponto; decimais só para produto fracionável (kg, g, L, mL, m).
double? parseLossQuantity(String? text) => double.tryParse((text ?? '').trim().replaceAll(',', '.'));

String? validateLossQuantity(String? text, {required bool fractional}) {
  final parsed = parseLossQuantity(text);
  if (parsed == null || parsed <= 0) return 'Informe uma quantidade válida';
  if (!fractional && parsed != parsed.roundToDouble()) return 'Quantidade inteira para esta unidade.';
  return null;
}
