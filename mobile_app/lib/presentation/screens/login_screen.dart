import 'package:flutter/material.dart';
import '../../app_services.dart';
import '../../core/network/api_client.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  // Preenchido quando o app cai aqui automaticamente por sessão expirada
  // (ver HomeScreen._goToExpiredSession) — evita que isso pareça uma falha
  // de conexão ou de credenciais.
  final String? sessionMessage;
  const LoginScreen({super.key, this.sessionMessage});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _errorMessage = widget.sessionMessage;
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
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.inventory_2_outlined, size: 72),
                  const SizedBox(height: 16),
                  Text(
                    'Controle de Perdas de Estoque',
                    style: Theme.of(context).textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'E-mail', border: OutlineInputBorder()),
                    validator: (value) =>
                        (value == null || !value.contains('@')) ? 'Informe um e-mail válido' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Senha', border: OutlineInputBorder()),
                    validator: (value) =>
                        (value == null || value.length < 6) ? 'Senha deve ter ao menos 6 caracteres' : null,
                  ),
                  if (_errorMessage != null) ...[
                    const SizedBox(height: 16),
                    Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _isLoading ? null : _submit,
                    child: _isLoading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Entrar'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
