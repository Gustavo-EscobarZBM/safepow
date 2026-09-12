/// Dados exibidos na tela de Perfil — vem sempre ao vivo de GET /users/me,
/// nunca cacheado localmente (ao contrário de Product/LossReason/LossLocation).
class UserProfile {
  final String name;
  final String email;
  final String role;
  final String? companyName;

  UserProfile({
    required this.name,
    required this.email,
    required this.role,
    this.companyName,
  });

  factory UserProfile.fromApiJson(Map<String, dynamic> json) {
    return UserProfile(
      name: json['name'] as String,
      email: json['email'] as String,
      role: json['role'] as String,
      companyName: json['companyName'] as String?,
    );
  }
}
