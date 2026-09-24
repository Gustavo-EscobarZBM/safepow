import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import '../config/app_config.dart';
import '../storage/secure_session_storage.dart';

/// http.MultipartFile.fromPath() sem `contentType` explícito sobe o arquivo
/// como application/octet-stream — o backend rejeita isso com "Formato de
/// imagem não suportado" mesmo para um JPEG/PNG genuíno (Seção 2.3 do
/// documento: só aceita image/jpeg, image/png, image/webp). image_picker
/// sempre grava .jpg (câmera) ou preserva a extensão original (galeria), daí
/// bastar olhar a extensão em vez de inspecionar os bytes do arquivo.
MediaType _mimeTypeForImagePath(String path) {
  final ext = path.toLowerCase().split('.').last;
  switch (ext) {
    case 'png':
      return MediaType('image', 'png');
    case 'webp':
      return MediaType('image', 'webp');
    default:
      return MediaType('image', 'jpeg');
  }
}

/// Lançada quando o backend responde 402 SUBSCRIPTION_INACTIVE (Seção 6.2 do
/// documento): a empresa está com a assinatura suspensa. A UI deve capturar
/// esta exceção especificamente e mostrar uma tela bloqueante, sem permitir
/// nova tentativa automática.
class SubscriptionInactiveException implements Exception {
  final String message;
  SubscriptionInactiveException(this.message);
}

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Lançada para falhas de rede (sem internet, timeout, DNS, etc.) — é o sinal
/// para o SyncQueueService manter o item na fila em vez de marcar como erro
/// definitivo (Seção 4.2 do documento).
class NetworkUnavailableException implements Exception {}

/// Lançada quando uma chamada autenticada volta com 401 — o token salvo no
/// celular expirou ou foi revogado. Distinta de NetworkUnavailableException
/// (a requisição chegou ao servidor normalmente) para que a UI possa reagir
/// corretamente: forçar logout e pedir um novo login, em vez de mostrar uma
/// mensagem de "sem conexão" que mascara o problema real.
class SessionExpiredException implements Exception {}

/// Resposta com os cabeçalhos — o sync de produtos lê X-Sync-Cursor / X-Next-After (SP1, 6.1/6.2).
class ApiResponse {
  final dynamic body;
  final Map<String, String> headers;

  const ApiResponse(this.body, this.headers);
}

class ApiClient {
  final SecureSessionStorage _sessionStorage;
  final http.Client _httpClient;

  ApiClient({SecureSessionStorage? sessionStorage, http.Client? httpClient})
      : _sessionStorage = sessionStorage ?? SecureSessionStorage(),
        _httpClient = httpClient ?? http.Client();

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<Map<String, String>> _headers({bool withAuth = true}) async {
    final headers = {'Content-Type': 'application/json'};
    if (withAuth) {
      final session = await _sessionStorage.read();
      if (session != null) {
        headers['Authorization'] = 'Bearer ${session.accessToken}';
      }
    }
    return headers;
  }

  Future<dynamic> get(String path) async {
    return _send(() async => _httpClient.get(_uri(path), headers: await _headers()));
  }

  /// Como [get], mas devolve também os cabeçalhos da resposta.
  Future<ApiResponse> getWithHeaders(String path) async {
    return _sendRaw(() async => _httpClient.get(_uri(path), headers: await _headers()));
  }

  Future<dynamic> post(String path, Map<String, dynamic> body, {bool withAuth = true}) async {
    return _send(
      () async => _httpClient.post(
        _uri(path),
        headers: await _headers(withAuth: withAuth),
        body: jsonEncode(body),
      ),
      withAuth: withAuth,
    );
  }

  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    return _send(
      () async => _httpClient.patch(
        _uri(path),
        headers: await _headers(),
        body: jsonEncode(body),
      ),
    );
  }

  /// Upload multipart — usado para enviar a foto da perda (Seção 2.3 do
  /// documento: object storage) antes de enviar o registro em si.
  Future<dynamic> postMultipartFile(String path, String filePath, {String fieldName = 'file'}) async {
    final headers = await _headers(); // sem Content-Type — o MultipartRequest define o boundary
    headers.remove('Content-Type');

    final request = http.MultipartRequest('POST', _uri(path))
      ..headers.addAll(headers)
      ..files.add(
        await http.MultipartFile.fromPath(
          fieldName,
          filePath,
          contentType: _mimeTypeForImagePath(filePath),
        ),
      );

    http.StreamedResponse streamedResponse;
    try {
      streamedResponse = await request.send().timeout(const Duration(seconds: 30));
    } catch (_) {
      throw NetworkUnavailableException();
    }

    final response = await http.Response.fromStream(streamedResponse);
    final decoded = response.body.isNotEmpty ? jsonDecode(response.body) : null;

    if (response.statusCode == 402) {
      final message = (decoded is Map && decoded['message'] != null)
          ? decoded['message'] as String
          : 'Acesso suspenso.';
      throw SubscriptionInactiveException(message);
    }
    if (response.statusCode == 401) {
      // postMultipartFile sempre envia Authorization (Seção 2.3) — um 401
      // aqui só pode significar token expirado, nunca "chamada sem token".
      throw SessionExpiredException();
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }
    final message = (decoded is Map && decoded['message'] != null)
        ? decoded['message'].toString()
        : 'Erro inesperado ao enviar arquivo (${response.statusCode}).';
    throw ApiException(response.statusCode, message);
  }

  Future<dynamic> _send(Future<http.Response> Function() request, {bool withAuth = true}) async {
    return (await _sendRaw(request, withAuth: withAuth)).body;
  }

  Future<ApiResponse> _sendRaw(Future<http.Response> Function() request, {bool withAuth = true}) async {
    http.Response response;
    try {
      response = await request().timeout(const Duration(seconds: 15));
    } catch (_) {
      // Cobre: sem internet, timeout, DNS falho, servidor fora do ar.
      throw NetworkUnavailableException();
    }

    final decoded = response.body.isNotEmpty ? jsonDecode(response.body) : null;

    if (response.statusCode == 402) {
      final message = (decoded is Map && decoded['message'] != null)
          ? decoded['message'] as String
          : 'Acesso suspenso. Entre em contato com o financeiro.';
      throw SubscriptionInactiveException(message);
    }

    // Só em chamadas autenticadas: no login (withAuth: false), 401 significa
    // credenciais erradas, não sessão expirada — deve continuar como ApiException.
    if (response.statusCode == 401 && withAuth) {
      throw SessionExpiredException();
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      // Nomes de cabeçalho em minúsculas sempre: o cliente de IO do package:http já entrega assim, mas outros
      // clientes (ex.: MockClient, web) preservam a grafia do servidor.
      return ApiResponse(decoded, {
        for (final header in response.headers.entries) header.key.toLowerCase(): header.value,
      });
    }

    final message = (decoded is Map && decoded['message'] != null)
        ? decoded['message'].toString()
        : 'Erro inesperado (${response.statusCode}).';
    throw ApiException(response.statusCode, message);
  }
}
