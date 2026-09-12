class AuthSession {
  final String accessToken;
  final String userId;
  final String userName;
  final String role; // 'manager' | 'employee' | 'master_admin'
  final String? companyId;

  AuthSession({
    required this.accessToken,
    required this.userId,
    required this.userName,
    required this.role,
    required this.companyId,
  });

  factory AuthSession.fromApiJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    return AuthSession(
      accessToken: json['accessToken'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String,
      role: user['role'] as String,
      companyId: user['companyId'] as String?,
    );
  }

  Map<String, dynamic> toStorageJson() => {
        'accessToken': accessToken,
        'userId': userId,
        'userName': userName,
        'role': role,
        'companyId': companyId,
      };

  factory AuthSession.fromStorageJson(Map<String, dynamic> json) => AuthSession(
        accessToken: json['accessToken'] as String,
        userId: json['userId'] as String,
        userName: json['userName'] as String,
        role: json['role'] as String,
        companyId: json['companyId'] as String?,
      );
}
