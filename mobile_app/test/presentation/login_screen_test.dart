import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/presentation/screens/login_screen.dart';

Future<void> pumpLogin(WidgetTester tester, {String? sessionMessage, int hour = 15}) async {
  tester.view.physicalSize = const Size(800, 1600);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      home: LoginScreen(
        sessionMessage: sessionMessage,
        clock: () => DateTime(2026, 9, 19, hour),
      ),
    ),
  );
}

void main() {
  testWidgets('mostra a logo oficial da SAFEPOW', (tester) async {
    await pumpLogin(tester);

    final logo = find.byWidgetPredicate(
      (widget) =>
          widget is Image &&
          widget.image is AssetImage &&
          (widget.image as AssetImage).assetName == 'assets/brand/logo_full.png',
    );
    expect(logo, findsOneWidget);
  });

  testWidgets('cumprimenta conforme a hora do dia', (tester) async {
    await pumpLogin(tester, hour: 15);

    expect(find.text('Boa tarde'), findsOneWidget);
    expect(find.text('Entrar'), findsWidgets);
  });

  testWidgets('esconde a senha por padrão e deixa mostrar e ocultar', (tester) async {
    await pumpLogin(tester);

    EditableText passwordField() =>
        tester.widget<EditableText>(find.byType(EditableText).last);

    expect(passwordField().obscureText, isTrue);

    await tester.tap(find.byTooltip('Mostrar senha'));
    await tester.pump();
    expect(passwordField().obscureText, isFalse);

    await tester.tap(find.byTooltip('Ocultar senha'));
    await tester.pump();
    expect(passwordField().obscureText, isTrue);
  });

  testWidgets('valida os campos antes de tentar entrar', (tester) async {
    await pumpLogin(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pump();

    expect(find.text('Informe um e-mail válido'), findsOneWidget);
    expect(find.text('Senha deve ter ao menos 6 caracteres'), findsOneWidget);
  });

  testWidgets('orienta a recuperar o acesso pelo gerente, sem prometer um fluxo inexistente', (tester) async {
    await pumpLogin(tester);

    expect(find.textContaining('Peça ao gerente da sua empresa para redefinir'), findsOneWidget);
  });

  testWidgets('mostra o aviso de sessão expirada quando o app cai na tela de login', (tester) async {
    await pumpLogin(tester, sessionMessage: 'Sua sessão expirou. Entre novamente.');

    expect(find.text('Sua sessão expirou. Entre novamente.'), findsOneWidget);
  });

  testWidgets('desenha a leitura do código de barras como imagem descrita', (tester) async {
    final semantics = tester.ensureSemantics();
    await pumpLogin(tester);

    expect(find.bySemanticsLabel('Código de barras sendo lido'), findsOneWidget);
    semantics.dispose();
  });
}
