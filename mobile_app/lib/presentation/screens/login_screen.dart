import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../core/network/api_client.dart';
import '../../core/util/greeting.dart';
import '../widgets/barcode_scan.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  // Preenchido quando o app cai aqui automaticamente por sessão expirada
  // (ver HomeScreen._goToExpiredSession) — evita que isso pareça uma falha
  // de conexão ou de credenciais.
  final String? sessionMessage;

  /// Relógio usado para a saudação; existe só para os testes fixarem a hora.
  @visibleForTesting
  final DateTime Function()? clock;

  const LoginScreen({super.key, this.sessionMessage, this.clock});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;
  late final String _greeting;

  @override
  void initState() {
    super.initState();
    _errorMessage = widget.sessionMessage;
    _greeting = greetingForHour((widget.clock ?? DateTime.now)().hour);
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await AppServices.authRepository.login(
        _emailController.text.trim(),
        _passwordController.text,
      );

      // Baixa os catálogos (produtos, motivos, locais) assim que loga, para
      // já funcionar offline em seguida (Seção 4.3 do documento).
      try {
        await AppServices.productRepository.refreshFromServer();
        await AppServices.lossReasonRepository.refreshFromServer();
        await AppServices.lossLocationRepository.refreshFromServer();
      } catch (_) {
        // Se não houver internet neste exato momento, segue mesmo assim —
        // os catálogos locais podem já existir de uma sessão anterior.
      }

      AppServices.syncQueueService.sessionExpired = false;
      AppServices.syncQueueService.start();

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const HomeScreen()),
      );
    } on ApiException catch (e) {
      setState(() => _errorMessage = e.message);
    } on NetworkUnavailableException {
      setState(() => _errorMessage = 'Sem conexão com a internet. Tente novamente.');
    } catch (e) {
      setState(() => _errorMessage = 'Erro inesperado ao entrar.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Image.asset(
                        'assets/brand/logo_full.png',
                        width: 200,
                        semanticLabel: 'SAFEPOW — Prevenção e controle de perdas',
                      ),
                    ),
                    const SizedBox(height: 40),
                    Text(_greeting, style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: 2),
                    Text(
                      'Entrar',
                      style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Use o e-mail e a senha da sua empresa.',
                      style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(
                        labelText: 'E-mail',
                        hintText: 'nome@empresa.com.br',
                        prefixIcon: Icon(Icons.mail_outline),
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) =>
                          (value == null || !value.contains('@')) ? 'Informe um e-mail válido' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'Senha',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _obscurePassword ? 'Mostrar senha' : 'Ocultar senha',
                          icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                        ),
                        border: const OutlineInputBorder(),
                      ),
                      validator: (value) =>
                          (value == null || value.length < 6) ? 'Senha deve ter ao menos 6 caracteres' : null,
                    ),
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: scheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.error_outline, size: 20, color: scheme.onErrorContainer),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _errorMessage!,
                                style: TextStyle(color: scheme.onErrorContainer),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      onPressed: _isLoading ? null : _submit,
                      child: _isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Entrar'),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      'Esqueceu a senha? Peça ao gerente da sua empresa para redefinir.',
                      style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 40),
                    const BarcodeScan(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
