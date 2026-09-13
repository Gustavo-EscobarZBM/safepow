class AuthSession {
  final String accessToken;
  final String userId;
  final String userName;
  final String role; // 'manager' | 'employee' | 'master_admin'
  final String? companyId;
  // Conferência de descarte (spec seção 5): capturados no momento do login,
  // guardados junto do resto da sessão — é assim que o app sabe, offline, se
  // deve mostrar o aviso de conferência ao registrar uma perda. Só atualizam
  // no próximo login (não há refresh automático durante a sessão aberta).
  final bool lossVerificationEnabled;
  final bool isLossVerifier;

  AuthSession({
    required this.accessToken,
    required this.userId,
    required this.userName,
    required this.role,
    required this.companyId,
    this.lossVerificationEnabled = false,
    this.isLossVerifier = false,
  });

  factory AuthSession.fromApiJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    return AuthSession(
      accessToken: json['accessToken'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String,
      role: user['role'] as String,
      companyId: user['companyId'] as String?,
      lossVerificationEnabled: json['lossVerificationEnabled'] as bool? ?? false,
      isLossVerifier: json['isLossVerifier'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toStorageJson() => {
        'accessToken': accessToken,
        'userId': userId,
        'userName': userName,
        'role': role,
        'companyId': companyId,
        'lossVerificationEnabled': lossVerificationEnabled,
        'isLossVerifier': isLossVerifier,
      };

  factory AuthSession.fromStorageJson(Map<String, dynamic> json) => AuthSession(
        accessToken: json['accessToken'] as String,
        userId: json['userId'] as String,
        userName: json['userName'] as String,
        role: json['role'] as String,
        companyId: json['companyId'] as String?,
        lossVerificationEnabled: json['lossVerificationEnabled'] as bool? ?? false,
        isLossVerifier: json['isLossVerifier'] as bool? ?? false,
      );
}
