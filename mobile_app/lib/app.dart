import 'package:flutter/material.dart';
import 'app_services.dart';
import 'presentation/screens/home_screen.dart';
import 'presentation/screens/login_screen.dart';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SAFEPOW',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF01352E),
        useMaterial3: true,
      ),
      home: const _SessionGate(),
    );
  }
}

/// Decide, na abertura do app, se mostra a tela de login ou já vai direto
/// para a tela inicial (sessão salva em armazenamento seguro).
class _SessionGate extends StatefulWidget {
  const _SessionGate();

  @override
  State<_SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<_SessionGate> {
  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: AppServices.authRepository.currentSession(),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snapshot.data != null) {
          AppServices.syncQueueService.start();
          return const HomeScreen();
        }
        return const LoginScreen();
      },
    );
  }
}
