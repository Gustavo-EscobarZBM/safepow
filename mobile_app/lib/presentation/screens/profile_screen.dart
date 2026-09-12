import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../core/network/api_client.dart';
import '../../data/models/user_profile.dart';

const _roleLabels = {
  'manager': 'Gerente',
  'employee': 'Funcionário',
  'master_admin': 'Administrador Master',
};

/// Mostra quem está logado neste aparelho — pedido depois da confusão de
/// contas/empresas do dia (Seção "Perfil"): nome, e-mail, papel e empresa,
/// sempre buscados ao vivo em GET /users/me (nunca cacheados localmente).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late Future<UserProfile> _future;

  @override
  void initState() {
    super.initState();
    _future = AppServices.authRepository.getMe();
  }

  void _showChangePasswordDialog() {
    final formKey = GlobalKey<FormState>();
    final currentController = TextEditingController();
    final newController = TextEditingController();
    bool isSaving = false;

    showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Trocar senha'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: currentController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha atual'),
                  validator: (v) => (v == null || v.isEmpty) ? 'Informe a senha atual' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: newController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Nova senha'),
                  validator: (v) =>
                      (v == null || v.length < 6) ? 'A nova senha deve ter ao menos 6 caracteres' : null,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: isSaving
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setDialogState(() => isSaving = true);
                      try {
                        await AppServices.authRepository.changePassword(
                          currentPassword: currentController.text,
                          newPassword: newController.text,
                        );
                        if (!dialogContext.mounted) return;
                        Navigator.pop(dialogContext);
                        if (!mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Senha alterada com sucesso.')),
                        );
                      } on ApiException catch (e) {
                        setDialogState(() => isSaving = false);
                        if (!dialogContext.mounted) return;
                        ScaffoldMessenger.of(dialogContext)
                            .showSnackBar(SnackBar(content: Text(e.message)));
                      } catch (_) {
                        setDialogState(() => isSaving = false);
                        if (!dialogContext.mounted) return;
                        ScaffoldMessenger.of(dialogContext).showSnackBar(
                          const SnackBar(content: Text('Não foi possível trocar a senha.')),
                        );
                      }
                    },
              child: isSaving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: FutureBuilder<UserProfile>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Não foi possível carregar o perfil. Verifique sua conexão e tente novamente.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          final profile = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(Icons.person_outline),
                      title: const Text('Nome'),
                      subtitle: Text(profile.name),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.email_outlined),
                      title: const Text('E-mail'),
                      subtitle: Text(profile.email),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.badge_outlined),
                      title: const Text('Papel'),
                      subtitle: Text(_roleLabels[profile.role] ?? profile.role),
                    ),
                    if (profile.companyName != null) ...[
                      const Divider(height: 1),
                      ListTile(
                        leading: const Icon(Icons.storefront_outlined),
                        title: const Text('Empresa'),
                        subtitle: Text(profile.companyName!),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _showChangePasswordDialog,
                icon: const Icon(Icons.lock_outline),
                label: const Text('Trocar senha'),
              ),
            ],
          );
        },
      ),
    );
  }
}
